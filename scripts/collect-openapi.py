import sys
import time
import urllib.request
import urllib.error
import json
import subprocess
import os

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing app target"}), file=sys.stderr)
        sys.exit(1)
        
    app_target = sys.argv[1]
    
    # Start uvicorn as a subprocess in the background
    # We must ensure uvicorn is available. The container should install it or we assume it's installed.
    # The prompt says we use a disposable container.
    uvicorn_process = subprocess.Popen(
        ["uvicorn", app_target, "--host", "127.0.0.1", "--port", "8000"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    try:
        max_retries = 50
        delay = 0.1
        openapi_url = "http://127.0.0.1:8000/openapi.json"
        
        for _ in range(max_retries):
            # Check if process died
            if uvicorn_process.poll() is not None:
                print(json.dumps({"error": "Uvicorn failed to start"}), file=sys.stderr)
                sys.exit(1)
                
            try:
                with urllib.request.urlopen(openapi_url, timeout=1) as response:
                    if response.status == 200:
                        data = response.read()
                        # Output exactly the JSON
                        sys.stdout.buffer.write(data)
                        sys.exit(0)
            except urllib.error.URLError:
                pass
            
            time.sleep(delay)
            
        print(json.dumps({"error": "Timeout waiting for openapi.json"}), file=sys.stderr)
        sys.exit(1)
    finally:
        uvicorn_process.terminate()
        uvicorn_process.wait()

if __name__ == "__main__":
    main()
