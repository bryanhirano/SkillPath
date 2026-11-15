# React + Vite

SkillPath is a career development application designed to help users identify skill gaps and explore learning pathways toward their target occupations.

## Resume upload, extraction, and analysis

Signed-in users can save resume text or upload a PDF/DOCX file smaller than 5 MB.
Uploaded files are stored privately under the user's `resumes/` path. The
`extract_resume_text` callable reads that user's uploaded file with the Firebase
Admin SDK and returns extracted text (PDFs are limited to 50 pages; extracted
text is limited to 100,000 characters).
The `analyze_resume` callable identifies skills, education, experience, and
possible occupations from an uploaded file using a preliminary keyword-based
rule set; it does not generate AI recommendations.

Deploy the Cloud Function and the Realtime Database and Storage rules together:

```sh
firebase deploy --only functions,database,storage
```

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
