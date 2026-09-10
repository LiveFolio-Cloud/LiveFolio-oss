"""Audit an HTML file for unbalanced tags (scripts and <pre> blocks stripped).

Usage:
    python3 verify_html_nesting.py path/to/file.html
"""
import re
import sys

if len(sys.argv) > 1:
    filepath = sys.argv[1]
else:
    print("Usage: python3 verify_html_nesting.py path/to/file.html")
    sys.exit(2)

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Strip out <script>...</script> blocks
content_no_scripts = re.sub(r'<script\b[^>]*>.*?</script>', '', content, flags=re.DOTALL)

# Strip out <pre><code>...</code></pre> blocks
content_no_code = re.sub(r'<pre\b[^>]*>.*?</pre>', '', content_no_scripts, flags=re.DOTALL)

# Now, find all HTML tags in this sanitized text
tags = re.findall(r'<(/?)([a-zA-Z0-9:-]+)(?:\s+[^>]*)?>', content_no_code)

print("Auditing sanitized HTML tags...")

open_tags = []
for idx, (is_closing, tag_name) in enumerate(tags):
    tag_name = tag_name.lower()
    # Skip self-closing tags
    if tag_name in ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', '!--']:
        continue
        
    if is_closing:
        if not open_tags:
            print(f"Error: Closing tag </{tag_name}> found but no tags are open.")
        else:
            last_open = open_tags.pop()
            if last_open != tag_name:
                print(f"Error: Closing tag </{tag_name}> does not match open tag <{last_open}>")
                open_tags.append(last_open) # Put it back to trace
    else:
        open_tags.append(tag_name)

if open_tags:
    print("\nUnclosed tags left at the end of the sanitized file:")
    for ot in open_tags:
        print(f"  - <{ot}>")
else:
    print("\nAll HTML tags are perfectly balanced!")
