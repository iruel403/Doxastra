import os
import json

examples_dir = 'Examples'
output_file = 'examples.js'

data = {}

if os.path.exists(examples_dir):
    for filename in os.listdir(examples_dir):
        if filename.endswith('.json'):
            path = os.path.join(examples_dir, filename)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    content = json.load(f)
                    name = filename[:-5]
                    data[name] = content
            except Exception as e:
                print(f"Failed to read {filename}: {e}")

js_content = f"window.ARCANIST_EXAMPLES = {json.dumps(data, indent=2)};"

with open(output_file, 'w', encoding='utf-8') as f:
    f.write(js_content)

print(f"Successfully generated {output_file} with {len(data)} examples.")
