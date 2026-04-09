import zipfile
import os

jar_path = r'D:\claude-web-platform\uploads\projects\1775728976310\secexample-1.0.jar'
extract_path = r'D:\claude-web-platform\uploads\projects\1775728976310\extracted'

# Create extraction directory if it doesn't exist
os.makedirs(extract_path, exist_ok=True)

# Extract JAR file
with zipfile.ZipFile(jar_path, 'r') as zip_ref:
    # List all files
    print("JAR Contents:")
    for name in zip_ref.namelist():
        print(f"  {name}")

    # Extract all files
    zip_ref.extractall(extract_path)
    print(f"\nExtracted to: {extract_path}")
