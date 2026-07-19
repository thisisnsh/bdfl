---
name: models
description: Open BDFL's model chooser and select the exact provider, model, and effort used for future runs. Use only when the user explicitly invokes the BDFL models skill to inspect or change the run model.
---

# BDFL Models

Immediately call the bundled BDFL MCP server's `models` tool and do not announce the tool call first. The tool owns listing, native selection, validation, and persistence.

If the user supplied an exact model, pass it only when the MCP tool schema accepts an explicit selection; otherwise call the selector and let the user choose it in the host dialog. Treat the MCP result as authoritative.

Never build a choice question yourself, paginate options, print terminal key instructions, or silently substitute a provider, model, or effort.
