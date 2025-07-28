# 📄 Round 1A: Document Layout Analysis Pipeline

This pipeline takes a PDF as input and performs **layout-aware document parsing** using **YOLOv10** for layout detection and **Tesseract.js** for OCR-based text extraction in *100 languages*. The output is a detailed hierarchical JSON capturing the document's structural elements, text content, and bounding boxes — optimized for multi-column and multi-layout PDF formats.

***

## 🚀 Overview

The pipeline performs the following steps:

1.  **PDF to Image Conversion**
2.  **Layout Detection using ONNX YOLOv10**
3.  **OCR using Tesseract.js (with Jimp/Canvas cropping)**
4.  **Post-processing & Annotation**
5.  **JSON + CSV Export with Hierarchical Structure**

***

## 🧠 Key Features

| Feature                 | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| ✅ **Layout Flexibility** | Detects content in **multi-column, single-column, and mixed layouts** |
| 🔤 **Text Extraction** | Uses `tesseract.js` for **OCR on each layout block** |
| 🧱 **Structured Output** | Outputs data in a **hierarchical JSON** with headings, text, tables, etc.   |
| 🎯 **Content Categorization** | Supports 11 layout labels from DocLayNet including `Text`, `Title`, `Table`, etc. |
| 🖼️ **Annotated Visuals** | Generates **annotated page images** with bounding boxes and labels          |

***

## 🖼️ Supported Layout Classes

The pipeline is trained on DocLayNet and recognizes the following structure types:

-   `Title`
-   `Section-header`
-   `Text`
-   `List-item`
-   `Table`
-   `Picture`
-   `Caption`
-   `Formula`
-   `Page-header`
-   `Page-footer`
-   `Footnote`

***

# PDF Document Layout Analysis Pipeline

## Core Components

### StepLibrary / Tool

| Component | Technology Stack |
|-----------|------------------|
| PDF → Images | pdf2pic, pdf-poppler, canvas, fallback to pdf-lib |
| Layout Detection | yolov10m-doclaynet_ONNX_document-layout-analysis (ONNX) via @huggingface/transformers |
| OCR | tesseract.js (JavaScript OCR) with jimp or canvas cropping |
| Bounding Box Drawing | canvas package |
| JSON / CSV Output | fs/promises for filesystem output |
| Export to Sheets | - |


### JSON

```json
{
  "metadata": { ... },
  "documentStructure": [ ... ],      // Hierarchical tree
  "allDetections": [ ... ],          // Flat list of all detections
  "pages": [ ... ],                  // Page-wise breakdown
  "ocrProcessingSuggestions": { ... } // Priority elements for re-OCR
}
```

Each detected element contains:

- **bbox** (bounding box)
- **label** (element type)
- **confidence**
- **pageNumber**
- **reading_order**
- **extractedText**


## Robustness

- ✔️ Works with scanned PDFs
- ✔️ Handles multi-column layouts
- ✔️ Layout-aware reading order

## Example Output Snapshot

```json
{
  "id": "page1_detection5",
  "label": "Text",
  "bbox": [50, 300, 600, 370],
  "confidence": 0.923,
  "pageNumber": 1,
  "extractedText": "This section covers the algorithmic steps in detail...",
  "reading_order": 5
}
```

## Conclusion

This pipeline transforms unstructured PDFs into structured, readable, and analyzable content — especially useful for downstream NLP tasks such as document summarization, relevance scoring, or entity extraction.

You can plug the generated `document_layout_analysis.json` directly into any semantic processing or summarization pipeline (like in Round 1B).