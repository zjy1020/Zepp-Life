#!/bin/bash
echo "=== StepWong Web ==="
echo "Stopping server..."
PIDS=$(ps aux | grep "python app.py" | grep -v grep | awk '{print $2}')
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null
  echo "Server stopped (PIDs: $PIDS)"
else
  echo "No running server found"
fi
