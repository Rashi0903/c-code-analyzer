# CodeSage - C Code Analyser WebApp

A **real-time C code analyser** with syntax and semantic error detection, accessible directly from your browser.  
Powered by a C-based backend for high performance and a modern React web interface for ease of use.

---

## 📌 Features
- **Code Editor in Browser** – Write and test your C programs directly online.  
- **Syntax Analysis** – Detects missing semicolons, unbalanced brackets, etc.  
- **Semantic Analysis** – Finds undeclared variables, type mismatches, and logical issues.  
- **Real-time Error Display** – Highlights exact lines and errors.  
- **Cross-platform** – Runs on any device with a browser.  
- **Fast & Lightweight** – Backend written in pure C for speed.  

---

## 🛠 Tech Stack

**Frontend**
- React.js  
- CodeMirror / Monaco Editor for code editing  
- Axios for API calls  

**Backend**
- C (Core analyser logic)  
- Flask (Python API wrapper to run C analyser)  

---

---

## ⚙️ Installation & Setup

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/Rashi0903/c-code-analyzer.git
cd c-code-analyzer
```
### 2️⃣ Backend Setup (C + Flask)
```bash
cd backend
make                       # Build the C analyser
pip install flask
python app.py              # Start Flask API
Backend will start at: http://localhost:5000
```
### 3️⃣ Frontend Setup (React)
```bash
cd frontend
npm install
npm start
```

---
📌 Usage

Open the webapp in your browser.

Type or paste your C program in the editor.

Click "Analyse" button.

Errors will be displayed in real-time with line numbers and details.

