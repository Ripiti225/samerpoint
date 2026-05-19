#!/usr/bin/env python3
import sys

MAIN = "android/app/src/main/java/com/samer/app/MainActivity.kt"

with open(MAIN, 'r') as f:
    content = f.read()

if 'onUserLeaveHint' in content:
    print("Already patched")
    sys.exit(0)

fix = (
    "\n"
    "  override fun onUserLeaveHint() {\n"
    "    try {\n"
    "      super.onUserLeaveHint()\n"
    "    } catch (e: NullPointerException) {\n"
    "      // Ignore React Native bug before full init\n"
    "    }\n"
    "  }\n"
    "}\n"
)

content = content.rstrip()
if content.endswith('}'):
    content = content[:-1] + fix
    with open(MAIN, 'w') as f:
        f.write(content)
    print("Patched OK")
else:
    print("ERROR: closing brace not found")
    sys.exit(1)
