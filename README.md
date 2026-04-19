# Arcanist Pro: Advanced Arcane Design Workstation

Arcanist Pro is a professional-grade, web-based design suite dedicated to the creation of intricate magic circles, alchemical diagrams, and esoteric sigils. It combines the precision of vector-based drafting with procedural generation and a dedicated symbol-forging environment.

![Arcanist Pro Preview](Arcanist/preview.png) *(Placeholder: Generate/Add your preview here)*

## 🌟 Key Features

### 🏗️ Tabbed Professional Workspace
Manage multiple designs simultaneously using the high-performance tab system. Switch between **Main Scenes** for composition and the **Symbol Forge** for component creation without losing state.

### 🔨 Symbol Forge
A dedicated drawing environment designed for "forging" custom vector symbols.
- **Vector Tools**: Draw precise strokes with snapping and symmetry.
- **Layer Management**: Organize your drawing into recursive layers.
- **Place in Scene**: Instantly convert your forge drawings into usable scene entities with one click.

### 📐 Transformation Gizmo
Interactive on-canvas controls for precise movement. Grab the Red (X) or Green (Y) arrows to constrain movement to an axis, or use the central square for free-form placement.

### 📜 Procedural Scripting (ArcanistAPI)
For designers who want the ultimate precision, Arcanist Pro features a powerful built-in scripting engine.
- Use the **Scripting Guide** to learn how to generate complex magic circles using `ArcanistAPI`.
- Bind properties to global variables for dynamic scaling and animation.

### 🗂️ Hierarchy & Inspector
A professional node-based structure that allows you to parent objects, group styles, and manage complex layers with ease. Use the Inspector to fine-tune every parameter from rotation speed to rim gap.

### 🔄 Advanced Undo System
Full `Ctrl + Z` support across the entire workstation. Every move, color change, or deletion is tracked so you can iterate without fear.

### 📚 Example Library
The **Hierarchy +** menu includes an "Examples" library that allows you to instantly load pre-made complex templates directly into your scene.

---

## 🚀 Quick Start

1. **Open `index.html`** in your browser.
2. Click **Windows > Hierarchy** to see your layers.
3. Click the **+** button in the Hierarchy to start adding Magic Circles, Polygons, or Text.
4. Use the **Inspector** to modify shapes. To add logic, toggle the **Move Arrows** (Gizmo) in the top bar.
5. Create custom symbols in the **Symbol Forge** tab and use "Place in Active Scene" to add them to your masterpiece.

## 📂 Project Structure

- `Arcanist/app.js`: Core engine, interaction logic, and Scene rendering.
- `Arcanist/forge.js`: Dedicated Symbol Forge logic and vector drawing engine.
- `Arcanist/index.html`: The workstation UI and layout.
- `Arcanist/Examples/`: Folder containing pre-made `.json` templates.
- `Arcanist/Symbols/`: Default library of esoteric assets.

## 🛠️ Installation & Hosting
Arcanist Pro is a standalone vanilla JavaScript application.
- **Local Use**: Just double-click `index.html`.
- **GitHub Pages**: Fully compatible with GitHub pages. 
- **Updating Examples**: If you add new `.json` files to the `Examples/` folder, run `build_examples.py` (or the Windows `.bat` file) to refresh the in-app list.

---

*Part of the **Doxastra** Project. Designed for the masters of the arcane.*
