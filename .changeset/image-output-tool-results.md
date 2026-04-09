---
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
---

Add image output support in tool results. Tool call results are now sent to the frontend via SSE. MCP adapter preserves image content blocks instead of discarding them. Google provider extracts Gemini native image parts. Image-aware snipping prevents base64 data from being destroyed by truncation. New ImagePreview component renders image thumbnails in ToolCallCard.
