# Presenting AI Governance Visually — Recommended Tools

Companion note to *AI Governance in Practice: The NIST AI RMF Playbook*.

Governance lives or dies by communication. The reference diagram style to aim for: clean flat boxes, labelled group containers, recognisable cloud-service icons — that style is the signature of **Eraser.io**. The hand-drawn whiteboard style of the original research sketch is **Excalidraw**.

## The toolkit

| Tool | Type | Why use it | Cost |
|---|---|---|---|
| **Eraser.io** | Web app + AI | The signature style of the reference diagram: labelled group containers, cloud-service icons, clean flat boxes. Supports diagram-as-code and DiagramGPT — generate a first draft from a text description, then refine | Free tier; Pro paid |
| **diagrams.net (draw.io)** | Web / desktop / VS Code | Free and offline-capable with full AWS/Azure/GCP icon libraries; the VS Code extension edits `.drawio.png` files that stay versioned alongside documents | Free |
| **Excalidraw** | Web / VS Code | The hand-drawn whiteboard style of the research sketch — ideal for thinking and workshops before formalising | Free |
| **Mermaid** | Text-to-diagram | Diagrams written as text inside Markdown; render natively on GitHub, Confluence and VS Code — best when diagrams must live with documentation | Free |
| **Lucidchart** | Web (team) | Polished collaborative diagrams with strong template libraries; good for teams already in its ecosystem | Paid |
| **Figma / FigJam** | Design platform | Presentation-grade visuals using community cloud-icon kits; best when diagrams feed slide decks and external documents | Free tier; paid |
| **Official cloud icon packs** | Asset libraries | AWS, Azure and GCP all publish official architecture icon sets (PowerPoint, SVG, Figma) — the fast way to make any tool's output look professional | Free |

## VS Code extensions

- **Draw.io Integration** (`hediet.vscode-drawio`) — edit `.drawio.png` files that are simultaneously valid images and editable diagrams, so they embed directly into Word and stay in version control.
- **Excalidraw** (`pomdtr.excalidraw-editor`) — whiteboard sketches as versioned files.
- **Markdown Preview Mermaid Support** (`bierner.markdown-mermaid`) — live-render Mermaid diagrams inside Markdown previews.

## Recommended workflow for reports

1. Think in Excalidraw (or on paper); formalise in Eraser.io or draw.io with official cloud icons.
2. Keep the diagram source file next to the document it serves, under version control.
3. Export PNG at 2× resolution before inserting into Word — crisp on screen and in print.
4. Use Mermaid for any diagram that must live inside Markdown, wikis or GitHub.

> The editable sources for the diagrams used in both reports are in [`diagrams/`](diagrams/):
>
> **Governance report:** `nist_cycle.svg`, `characteristics.svg`, `pillars.svg`, `lifecycle.svg`, `adoption_gap.svg`, `penalty_comparison.svg`, `implement_once.svg`
>
> **Frameworks report:** `framework_landscape.svg`, `framework_coverage.svg`, `framework_timeline.svg`, `gateway_architecture.svg`, `tool_maturity.svg`
