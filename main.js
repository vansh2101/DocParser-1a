import fs from "fs/promises";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import { AutoModel, AutoProcessor, RawImage } from "@huggingface/transformers";

// Try to import OCR libraries - using tesseract.js worker approach
let createWorker, Jimp;
let ocrAvailable = false;

try {
  const tesseractModule = await import("tesseract.js");
  createWorker = tesseractModule.createWorker;
  console.log("✅ tesseract.js loaded successfully");
  ocrAvailable = true;
} catch (e) {
  console.warn("⚠️  tesseract.js not available:", e.message);
}

try {
  const jimpModule = await import("jimp");
  Jimp = jimpModule.default;
  console.log("✅ Jimp loaded for image processing");
} catch (e) {
  console.warn("⚠️  Jimp not available for image processing");
}

let pdfPoppler, pdfLib;


try {
  const pdfPopplerModule = await import("pdf-poppler");
  pdfPoppler = pdfPopplerModule.default;
} catch (e) {
  console.warn("⚠️  pdf-poppler not available");
}

try {
  const pdfLibModule = await import("pdf-lib");
  pdfLib = pdfLibModule.PDFDocument;
} catch (e) {
  console.warn("⚠️  pdf-lib not available");
}

// Configuration
const TEMP_DIR = "./temp_images";
const OUTPUT_DIR = "./output";
const ANNOTATED_DIR = "./output/annotated_frames";
// PDF filename will be provided as a command-line argument
const PDF_PATH = process.argv[2] || "./data/OS-LabFile-HemangJAin_23CS174.pdf"; // Default fallback
const CONFIDENCE_THRESHOLD = 0.50;

// OCR Configuration for tesseract.js worker
const OCR_CONFIG = {
  enabled: ocrAvailable,
  language: "eng", // Tesseract language: eng, fra, deu, spa, etc.
};

// Document layout labels
const id2label = {
  0: "Caption",
  1: "Footnote",
  2: "Formula",
  3: "List-item",
  4: "Page-footer",
  5: "Page-header",
  6: "Picture",
  7: "Section-header",
  8: "Table",
  9: "Text",
  10: "Title",
};

// Colors for different element types
const colors = {
  Title: "#FF0000",
  "Section-header": "#00FF00",
  Text: "#0000FF",
  "List-item": "#FF00FF",
  Table: "#FFFF00",
  Picture: "#00FFFF",
  Caption: "#FFA500",
  Formula: "#800080",
  Footnote: "#808080",
  "Page-header": "#008000",
  "Page-footer": "#800000",
};

// Global OCR worker for reuse across all text extractions
let ocrWorker = null;

// Initialize OCR worker
async function initializeOCRWorker() {
  if (!OCR_CONFIG.enabled || ocrWorker) return;

  try {
    console.log("🔄 Initializing OCR worker...");
    ocrWorker = await createWorker(OCR_CONFIG.language);
    console.log("✅ OCR worker initialized");
  } catch (error) {
    console.warn("⚠️  Failed to initialize OCR worker:", error.message);
  }
}

// Cleanup OCR worker
async function cleanupOCRWorker() {
  if (ocrWorker) {
    try {
      await ocrWorker.terminate();
      ocrWorker = null;
      console.log("✅ OCR worker terminated");
    } catch (error) {
      console.warn("⚠️  Error terminating OCR worker:", error.message);
    }
  }
}

// OCR function to extract text from image region using tesseract.js worker
async function extractTextFromRegion(imagePath, bbox, elementType) {
  if (!OCR_CONFIG.enabled || !ocrWorker) {
    return `[${elementType} content - OCR not available]`;
  }

  // Skip OCR for elements that typically don't contain readable text
  if (elementType === "Picture") {
    return `[${elementType} - image content]`;
  }

  try {
    console.log(`🔍 Extracting text from ${elementType} region...`);

    // Create temp file for cropped region
    const tempCropPath = path.join(
      TEMP_DIR,
      `crop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`
    );

    // Method 1: Try using Canvas (existing method)
    try {
      const image = await loadImage(imagePath);
      const cropWidth = bbox[2] - bbox[0];
      const cropHeight = bbox[3] - bbox[1];

      // Ensure minimum dimensions
      if (cropWidth < 10 || cropHeight < 10) {
        throw new Error("Region too small for OCR");
      }

      const canvas = createCanvas(cropWidth, cropHeight);
      const ctx = canvas.getContext("2d");

      // Crop the region
      ctx.drawImage(
        image,
        bbox[0],
        bbox[1], // Source x, y
        cropWidth,
        cropHeight, // Source width, height
        0,
        0, // Destination x, y
        cropWidth,
        cropHeight // Destination width, height
      );

      // Save cropped image to temp file
      const buffer = canvas.toBuffer("image/png");
      await fs.writeFile(tempCropPath, buffer);
    } catch (canvasError) {
      console.warn("Canvas crop failed, trying Jimp:", canvasError.message);

      // Method 2: Fallback to Jimp if available
      if (Jimp) {
        try {
          const image = await Jimp.read(imagePath);
          const cropped = image.crop(
            bbox[0],
            bbox[1],
            bbox[2] - bbox[0],
            bbox[3] - bbox[1]
          );
          await cropped.writeAsync(tempCropPath);
        } catch (jimpError) {
          throw new Error(
            `Both Canvas and Jimp failed: ${canvasError.message}, ${jimpError.message}`
          );
        }
      } else {
        throw canvasError;
      }
    }

    // Perform OCR using tesseract.js worker
    const {
      data: { text },
    } = await ocrWorker.recognize(tempCropPath);

    // Clean up temp file
    try {
      await fs.unlink(tempCropPath);
    } catch (e) {
      // Ignore cleanup errors
    }

    // Clean up the extracted text
    const cleanedText = text.trim().replace(/\s+/g, " ");

    if (cleanedText.length > 0) {
      console.log(
        `✅ Extracted: "${cleanedText.substring(0, 50)}${
          cleanedText.length > 50 ? "..." : ""
        }"`
      );
      return cleanedText;
    } else {
      return `[${elementType} - text extraction failed]`;
    }
  } catch (error) {
    console.warn(`⚠️  OCR failed for ${elementType}:`, error.message);
    return `[${elementType} - OCR error]`;
  }
}

// Enhanced function to extract text with retry mechanism
async function extractTextWithRetry(
  imagePath,
  bbox,
  elementType,
  maxRetries = 2
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const text = await extractTextFromRegion(imagePath, bbox, elementType);
      if (
        text &&
        !text.includes("extraction failed") &&
        !text.includes("OCR error")
      ) {
        return text;
      }
    } catch (error) {
      console.warn(`OCR attempt ${attempt} failed:`, error.message);
    }

    if (attempt < maxRetries) {
      console.log(`🔄 Retrying OCR (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retry
    }
  }

  return `[${elementType} content (Page)]`; // Fallback
}

// Create required directories
async function setupDirectories() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.mkdir(ANNOTATED_DIR, { recursive: true });
    console.log("✅ Directories created successfully");
  } catch (error) {
    console.error("❌ Failed to create directories:", error.message);
    throw error;
  }
}

// Method 2: Try pdf-poppler
async function tryPdfPoppler(pdfPath) {
  if (!pdfPoppler) throw new Error("pdf-poppler not available");

  console.log("🔄 Trying pdf-poppler conversion...");

  const options = {
    format: "png",
    out_dir: TEMP_DIR,
    out_prefix: "page",
    page: null, // All pages
  };

  const results = await pdfPoppler.convert(pdfPath, options);

  // Get the generated file paths
  const files = await fs.readdir(TEMP_DIR);
  const pngFiles = files.filter((f) => f.endsWith(".png")).sort();
  return pngFiles.map((f) => path.join(TEMP_DIR, f));
}

// Main PDF conversion function with multiple fallbacks
async function convertPdfToImages(pdfPath) {
  console.log("🔄 Converting PDF to images...");
  const startTime = performance.now();

  // Clear temp directory first
  try {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (e) {
    // Directory might not exist
  }

  const methods = [
    { name: "pdf-poppler", func: tryPdfPoppler }
  ];

  let lastError;
  for (const method of methods) {
    try {
      console.log(`🔧 Attempting ${method.name}...`);
      const imagePaths = await method.func(pdfPath);

      if (imagePaths && imagePaths.length > 0) {
        const conversionTime = ((performance.now() - startTime) / 1000).toFixed(
          2
        );
        console.log(
          `✅ Successfully converted ${imagePaths.length} pages using ${method.name} in ${conversionTime}s`
        );
        return imagePaths;
      }
    } catch (error) {
      console.warn(`⚠️  ${method.name} failed:`, error.message);
      lastError = error;
      continue;
    }
  }

  throw new Error(
    `All PDF conversion methods failed. Last error: ${lastError?.message}`
  );
}

// Load YOLO model and processor
async function loadModel() {
  console.log("🔄 Loading YOLO model...");
  const startTime = performance.now();

  try {
    const model = await AutoModel.from_pretrained(
      "Oblix/yolov10m-doclaynet_ONNX_document-layout-analysis",
      { dtype: "fp32" }
    );

    const processor = await AutoProcessor.from_pretrained(
      "Oblix/yolov10m-doclaynet_ONNX_document-layout-analysis"
    );

    const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Model loaded in ${loadTime}s`);

    return { model, processor };
  } catch (error) {
    console.error("❌ Model loading failed:", error.message);
    throw error;
  }
}

// Process single page with YOLO model
async function processPage(model, processor, imagePath, pageNumber) {
  const startTime = performance.now();
  console.log(`🔄 Processing page ${pageNumber}...`);

  try {
    // Load and process image
    const image = await RawImage.read(imagePath);
    const { pixel_values, reshaped_input_sizes } = await processor(image);

    // Run YOLO inference
    const { output0 } = await model({ images: pixel_values });
    const predictions = output0.tolist()[0];

    // Convert predictions to proper format
    const [newHeight, newWidth] = reshaped_input_sizes[0];
    const [xs, ys] = [image.width / newWidth, image.height / newHeight];

    console.log(
      `🔍 Found ${predictions.length} potential detections, filtering by confidence...`
    );
    const detections = [];

    for (const [xmin, ymin, xmax, ymax, score, id] of predictions) {
      if (score < CONFIDENCE_THRESHOLD) continue;

      const bbox = [
        Math.round(xmin * xs),
        Math.round(ymin * ys),
        Math.round(xmax * xs),
        Math.round(ymax * ys),
      ];

      const label = id2label[id] || "Unknown";

      // Extract text using OCR for this detection
      console.log(`📝 Processing ${label} detection...`);
      const extractedText = await extractTextWithRetry(imagePath, bbox, label);

      const detection = {
        id: `page${pageNumber}_detection${detections.length + 1}`,
        bbox: bbox,
        bbox_normalized: [
          parseFloat((bbox[0] / image.width).toFixed(4)),
          parseFloat((bbox[1] / image.height).toFixed(4)),
          parseFloat((bbox[2] / image.width).toFixed(4)),
          parseFloat((bbox[3] / image.height).toFixed(4)),
        ],
        label: label,
        confidence: parseFloat(score.toFixed(3)),
        area: Math.round((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])),
        center: [
          Math.round((bbox[0] + bbox[2]) / 2),
          Math.round((bbox[1] + bbox[3]) / 2),
        ],
        width: Math.round(bbox[2] - bbox[0]),
        height: Math.round(bbox[3] - bbox[1]),
        extractedText: extractedText, // Store the extracted text
      };

      detections.push(detection);
    }

    console.log(`✅ Processed ${detections.length} detections with OCR`);

    // Sort detections by reading order (top to bottom, left to right)
    detections.sort((a, b) => {
      const yDiff = a.center[1] - b.center[1];
      if (Math.abs(yDiff) > 20) return yDiff; // Different rows
      return a.center[0] - b.center[0]; // Same row, sort by x
    });

    // Add reading order index
    detections.forEach((detection, index) => {
      detection.reading_order = index + 1;
    });

    // Create annotated image
    const annotatedPath = path.join(
      ANNOTATED_DIR,
      `page_${pageNumber}_annotated.png`
    );
    await createAnnotatedImage(imagePath, detections, annotatedPath);

    const processingTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(
      `✅ Page ${pageNumber} processed in ${processingTime}s - Found ${detections.length} elements`
    );

    return {
      pageNumber,
      processingTime: parseFloat(processingTime),
      detections: detections, // Return full detection objects with extracted text
      annotatedPath,
      sourceImagePath: imagePath,
      imageWidth: image.width,
      imageHeight: image.height,
    };
  } catch (error) {
    console.error(`❌ Error processing page ${pageNumber}:`, error.message);
    throw error;
  }
}

// Create annotated image with bounding boxes
async function createAnnotatedImage(imagePath, detections, outputPath) {
  try {
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");

    // Draw original image
    ctx.drawImage(image, 0, 0);

    // Draw annotations
    ctx.lineWidth = 3;
    ctx.font = "16px Arial";
    ctx.textBaseline = "top";

    detections.forEach((detection) => {
      const { bbox, label, confidence } = detection;
      const [xmin, ymin, xmax, ymax] = bbox;
      const color = colors[label] || "#FFFFFF";

      // Draw bounding box
      ctx.strokeStyle = color;
      ctx.strokeRect(xmin, ymin, xmax - xmin, ymax - ymin);

      // Draw label background
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(xmin, ymin - 20, 250, 20);

      // Draw label text
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = "#000000";
      ctx.fillText(
        `${label} (${(confidence * 100).toFixed(1)}%)`,
        xmin + 2,
        ymin - 18
      );
    });

    // Save annotated image
    const buffer = canvas.toBuffer("image/png");
    await fs.writeFile(outputPath, buffer);
  } catch (error) {
    console.error("❌ Error creating annotated image:", error.message);
    throw error;
  }
}

// Save all bounding box detections to hierarchical JSON structure
async function saveBoundingBoxesToJson(results, totalTime) {
  try {
    console.log("💾 Saving bounding boxes to hierarchical JSON...");

    // Organize data by element type for easy filtering
    const elementsByType = {};
    const allDetections = [];

    // Process each page result
    results.forEach((pageResult) => {
      pageResult.detections.forEach((detection) => {
        // Add page context to detection
        const enrichedDetection = {
          ...detection,
          pageNumber: pageResult.pageNumber,
          sourceImagePath: pageResult.sourceImagePath,
          annotatedImagePath: pageResult.annotatedPath,
          pageWidth: pageResult.imageWidth,
          pageHeight: pageResult.imageHeight,
        };

        allDetections.push(enrichedDetection);

        // Group by element type
        if (!elementsByType[detection.label]) {
          elementsByType[detection.label] = [];
        }
        elementsByType[detection.label].push(enrichedDetection);
      });
    });

    // Create hierarchical document structure
    const documentHierarchy = buildDocumentHierarchy(allDetections);

    // Create comprehensive JSON structure
    const jsonOutput = {
      metadata: {
        totalPages: results.length,
        totalDetections: allDetections.length,
        processingTime: totalTime,
        averageTimePerPage: (totalTime / results.length).toFixed(2),
        confidence_threshold: CONFIDENCE_THRESHOLD,
        processedAt: new Date().toISOString(),
        pdfPath: PDF_PATH,
        elementTypeCounts: Object.keys(elementsByType).reduce((acc, type) => {
          acc[type] = elementsByType[type].length;
          return acc;
        }, {}),
      },

      // Hierarchical document structure (main format requested)
      documentStructure: documentHierarchy,

      // Flat list of all detections for reference
      allDetections: allDetections,

      // Organized by page for easy page-by-page processing
      pages: results.map((pageResult) => ({
        pageNumber: pageResult.pageNumber,
        processingTime: pageResult.processingTime,
        sourceImagePath: pageResult.sourceImagePath,
        annotatedImagePath: pageResult.annotatedPath,
        imageWidth: pageResult.imageWidth,
        imageHeight: pageResult.imageHeight,
        detectionsCount: pageResult.detections.length,
        detections: pageResult.detections.map((det) => ({
          ...det,
          pageNumber: pageResult.pageNumber,
        })),
      })),

      // OCR processing suggestions
      ocrProcessingSuggestions: {
        textElements: (elementsByType["Text"] || []).map((det) => ({
          id: det.id,
          pageNumber: det.pageNumber,
          bbox: det.bbox,
          bbox_normalized: det.bbox_normalized,
          priority: "high",
        })),

        titleElements: (elementsByType["Title"] || []).map((det) => ({
          id: det.id,
          pageNumber: det.pageNumber,
          bbox: det.bbox,
          bbox_normalized: det.bbox_normalized,
          priority: "highest",
        })),

        tableElements: (elementsByType["Table"] || []).map((det) => ({
          id: det.id,
          pageNumber: det.pageNumber,
          bbox: det.bbox,
          bbox_normalized: det.bbox_normalized,
          priority: "high",
          processingNote:
            "Use table-specific OCR for better structure recognition",
        })),

        listElements: (elementsByType["List-item"] || []).map((det) => ({
          id: det.id,
          pageNumber: det.pageNumber,
          bbox: det.bbox,
          bbox_normalized: det.bbox_normalized,
          priority: "medium",
        })),
      },
    };

    // Save to JSON file
    const jsonPath = path.join(OUTPUT_DIR, "document_layout_analysis.json");
    await fs.writeFile(jsonPath, JSON.stringify(jsonOutput, null, 2));

    console.log(`✅ Hierarchical JSON saved to: ${jsonPath}`);
    console.log(`📊 Total detections saved: ${allDetections.length}`);

    // Also save a simple CSV format for quick analysis
    const csvPath = path.join(OUTPUT_DIR, "detections_summary.csv");
    const csvHeaders =
      "Page,Element_Type,Confidence,X_Min,Y_Min,X_Max,Y_Max,Width,Height,Area,Reading_Order\n";
    const csvRows = allDetections
      .map(
        (det) =>
          `${det.pageNumber},${det.label},${det.confidence},${det.bbox[0]},${det.bbox[1]},${det.bbox[2]},${det.bbox[3]},${det.width},${det.height},${det.area},${det.reading_order}`
      )
      .join("\n");

    await fs.writeFile(csvPath, csvHeaders + csvRows);
    console.log(`📊 CSV summary saved to: ${csvPath}`);

    return jsonPath;
  } catch (error) {
    console.error("❌ Error saving bounding boxes to JSON:", error.message);
    throw error;
  }
}

// Build hierarchical document structure
function buildDocumentHierarchy(detections) {
  console.log("🏗️  Building hierarchical document structure...");

  // Sort detections by page and reading order
  const sortedDetections = detections.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) {
      return a.pageNumber - b.pageNumber;
    }
    return a.reading_order - b.reading_order;
  });

  const hierarchy = [];
  const headingStack = []; // Stack to track current heading hierarchy

  // Define heading levels (you can adjust this based on your needs)
  const headingLevels = {
    Title: "H1",
    "Section-header": "H2",
    "Page-header": "H3",
    Caption: "H4",
  };

  sortedDetections.forEach((detection) => {
    const { label, bbox, pageNumber, confidence, id, extractedText } =
      detection;

    if (headingLevels[label]) {
      // This is a heading element
      const level = headingLevels[label];
      const headingNode = {
        id: id,
        title: extractedText || `${label} (Page ${pageNumber})`, // Use extracted text or fallback
        level: level,
        page: pageNumber,
        bbox: bbox,
        bbox_normalized: detection.bbox_normalized,
        confidence: confidence,
        children: [],
      };

      // Find the right place in hierarchy based on heading level
      const levelNum = parseInt(level.replace("H", ""));

      // Pop headings from stack that are at same or lower level
      while (
        headingStack.length > 0 &&
        parseInt(
          headingStack[headingStack.length - 1].level.replace("H", "")
        ) >= levelNum
      ) {
        headingStack.pop();
      }

      if (headingStack.length === 0) {
        // Top level heading
        hierarchy.push(headingNode);
      } else {
        // Add as child to current parent
        headingStack[headingStack.length - 1].children.push(headingNode);
      }

      headingStack.push(headingNode);
    } else {
      // This is content (text, table, list, etc.)
      const contentNode = {
        id: id,
        type: label.toLowerCase().replace("-", "_"),
        content: extractedText || `${label} content (Page ${pageNumber})`, // Use extracted text or fallback
        bbox: bbox,
        bbox_normalized: detection.bbox_normalized,
        page: pageNumber,
        confidence: confidence,
        width: detection.width,
        height: detection.height,
        area: detection.area,
        reading_order: detection.reading_order,
      };

      if (headingStack.length > 0) {
        // Add content under current heading
        headingStack[headingStack.length - 1].children.push(contentNode);
      } else {
        // No current heading - create a default section
        const defaultSection = {
          id: `default_section_page_${pageNumber}`,
          title: `Content (Page ${pageNumber})`,
          level: "H1",
          page: pageNumber,
          children: [contentNode],
        };
        hierarchy.push(defaultSection);
        headingStack.push(defaultSection);
      }
    }
  });

  console.log(`✅ Built hierarchy with ${hierarchy.length} top-level sections`);
  return hierarchy;
}


// Main processing pipeline
async function main() {
  const totalStartTime = performance.now();

  try {
    console.log("🚀 Starting PDF Document Layout Analysis with OCR\n");

    // Show OCR status
    if (OCR_CONFIG.enabled) {
      console.log("🔤 OCR Status: ENABLED (using tesseract.js)");
      console.log(`📖 Language: ${OCR_CONFIG.language}`);
      console.log("✨ Text will be extracted from all detected regions\n");
    } else {
      console.log("🔤 OCR Status: DISABLED");
      console.log(
        "⚠️  Install OCR dependencies: npm install tesseract.js jimp"
      );
      console.log(
        "💡 Tesseract.js runs entirely in JavaScript - no system installation required!\n"
      );
    }

    // Show which PDF is being processed
    console.log(`📄 PDF to process: ${PDF_PATH}`);

    // Setup
    await setupDirectories();

    // Initialize OCR worker
    await initializeOCRWorker();

    const { model, processor } = await loadModel();

    // Convert PDF to images
    const imagePaths = await convertPdfToImages(PDF_PATH);
    console.log("");

    // Process each page with OCR
    console.log("🔄 Processing pages with layout detection and OCR...");
    const results = [];
    let totalOCRTime = 0;

    for (let i = 0; i < imagePaths.length; i++) {
      const ocrStartTime = performance.now();
      const result = await processPage(model, processor, imagePaths[i], i + 1);
      const ocrEndTime = performance.now();

      const pageOCRTime = (ocrEndTime - ocrStartTime) / 1000;
      totalOCRTime += pageOCRTime;

      results.push(result);

      // Show progress with OCR info
      if (OCR_CONFIG.enabled) {
        const textExtractions = result.detections.filter(
          (d) =>
            d.extractedText &&
            !d.extractedText.includes("OCR not available") &&
            !d.extractedText.includes("extraction failed")
        ).length;
        console.log(
          `📝 Extracted text from ${textExtractions}/${result.detections.length} regions`
        );
      }
    }

    // Calculate total time
    const totalTime = ((performance.now() - totalStartTime) / 1000).toFixed(2);

    // Print enhanced summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 PROCESSING SUMMARY");
    console.log("=".repeat(60));
    console.log(`📄 Total Pages: ${results.length}`);
    console.log(`⏱️  Total Time: ${totalTime}s`);
    console.log(
      `🔤 OCR Time: ${totalOCRTime.toFixed(2)}s (${(
        (totalOCRTime / parseFloat(totalTime)) *
        100
      ).toFixed(1)}%)`
    );
    console.log(
      `⚡ Average Time/Page: ${(parseFloat(totalTime) / results.length).toFixed(
        2
      )}s`
    );

    const totalElements = results.reduce(
      (sum, r) => sum + r.detections.length,
      0
    );
    console.log(`🔍 Total Elements Found: ${totalElements}`);

    if (OCR_CONFIG.enabled) {
      const totalTextExtractions = results.reduce(
        (sum, r) =>
          sum +
          r.detections.filter(
            (d) =>
              d.extractedText &&
              !d.extractedText.includes("OCR not available") &&
              !d.extractedText.includes("extraction failed")
          ).length,
        0
      );
      console.log(
        `📝 Successful Text Extractions: ${totalTextExtractions}/${totalElements} (${(
          (totalTextExtractions / totalElements) *
          100
        ).toFixed(1)}%)`
      );
    }

    console.log(`📁 Annotated images saved to: ${ANNOTATED_DIR}`);

    console.log("\n📋 PAGE-BY-PAGE BREAKDOWN:");
    results.forEach((result) => {
      const textCount = OCR_CONFIG.enabled
        ? result.detections.filter(
            (d) =>
              d.extractedText &&
              !d.extractedText.includes("OCR not available") &&
              !d.extractedText.includes("extraction failed")
          ).length
        : 0;

      console.log(
        `  Page ${result.pageNumber}: ${result.processingTime}s (${
          result.detections.length
        } elements${OCR_CONFIG.enabled ? `, ${textCount} with text` : ""})`
      );
    });

    console.log("\n✅ Processing complete!");

    // Save bounding boxes to JSON for further OCR processing
    const jsonPath = await saveBoundingBoxesToJson(
      results,
      parseFloat(totalTime)
    );

    console.log("\n" + "=".repeat(60));
    console.log("📊 OUTPUT FILES");
    console.log("=".repeat(60));
    console.log(`🖼️  Annotated Images: ${ANNOTATED_DIR}/`);
    console.log(`📄 Hierarchical JSON: ${jsonPath}`);
    console.log(
      `📊 CSV Summary: ${path.join(OUTPUT_DIR, "detections_summary.csv")}`
    );
    console.log("\n🎯 Next Steps:");
    if (OCR_CONFIG.enabled) {
      console.log("  • ✅ Text extraction completed automatically");
      console.log(
        "  • 📋 Use the hierarchical JSON with extracted text content"
      );
      console.log("  • 🔍 Review and validate extracted text accuracy");
      console.log("  • 📝 Use structured content for further processing");
    } else {
      console.log(
        "  • 📦 Install OCR dependencies: npm install tesseract.js jimp"
      );
      console.log("  • 🔄 Re-run for full OCR functionality");
    }
    console.log("  • 🏗️  Document structure is ready for analysis");
    console.log("  • 📊 Export to other formats as needed");

    console.log("\n💡 JSON Structure:");
    console.log("  • documentStructure: Hierarchical tree with extracted text");
    console.log("  • allDetections: Flat list with OCR results");
    console.log("  • pages: Page-by-page organization");
    console.log("  • ocrProcessingSuggestions: Priority-based targets");

    // Cleanup OCR worker and temp files
    await cleanupOCRWorker();
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error("❌ Fatal error:", error.message);
    // Ensure OCR worker is cleaned up even on error
    await cleanupOCRWorker();
    process.exit(1);
  }
}

// Run the pipeline
main();
