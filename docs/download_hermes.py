import urllib.request
import re
import os
import json

url = "https://hermes4.nousresearch.com/"
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req).read().decode('utf-8')
    
    script_urls = re.findall(r'<script[^>]+src="([^"]+)"', html)
    print(f"Found {len(script_urls)} scripts.")
    
    os.makedirs("/tmp/hermes4_js", exist_ok=True)
    
    combined_js = ""
    for src in script_urls:
        if src.startswith('/'):
            full_url = "https://hermes4.nousresearch.com" + src
        else:
            full_url = src
            
        print(f"Downloading {full_url}")
        try:
            req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
            js = urllib.request.urlopen(req).read().decode('utf-8')
            combined_js += f"\n\n/* --- {src} --- */\n\n" + js
        except Exception as e:
            print(f"Failed to download {full_url}: {e}")

    with open("/tmp/hermes4_js/all_scripts.js", "w") as f:
        f.write(combined_js)
    print("Saved to /tmp/hermes4_js/all_scripts.js")
    
except Exception as e:
    print(f"Error: {e}")
