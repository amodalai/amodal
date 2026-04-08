---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
"@amodalai/amodal": patch
"@amodalai/runtime-app": patch
---

Add image paste support to chat

Users can paste images from the clipboard into the chat input. Images show as removable thumbnails before sending, then render in the user message bubble. Vision-capable providers (Anthropic, Google, OpenAI) receive the image; non-vision providers strip it with a warning. Images are stored in a separate `image_data` column to avoid JSONB bloat, with automatic rehydration on session load.
