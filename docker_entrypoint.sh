#!/bin/bash
set -e

INPUT_DIR="/app/input"
OUTPUT_DIR="/app/output"

# Find all PDFs in input directory
PDFS=$(find "$INPUT_DIR" -type f -name '*.pdf')

if [ -z "$PDFS" ]; then
  echo "No PDF files found in $INPUT_DIR."
  exit 1
fi

# Process each PDF
for pdf in $PDFS; do
  filename=$(basename "$pdf" .pdf)
  output_json="$OUTPUT_DIR/${filename}.json"
  echo "Processing $pdf -> $output_json"
  node main.js "$pdf" > /dev/null
  # Move the output JSON to the correct filename
  if [ -f "/app/output/document_layout_analysis.json" ]; then
    mv /app/output/document_layout_analysis.json "$output_json"
  fi
  # Optionally move annotated images, etc. if needed
  # mv /app/output/annotated_frames ...
done

# Optionally, create a summary output.json (could be a merge or just a copy)
cp "$OUTPUT_DIR"/*.json "$OUTPUT_DIR/output.json" 2>/dev/null || true
