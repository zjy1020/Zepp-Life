#!/bin/bash
cd "$(dirname "$0")"
echo "=== StepWong Web ==="
echo "Starting server..."
python app.py &
echo "Server started! Open http://127.0.0.1:5800 in your browser"
