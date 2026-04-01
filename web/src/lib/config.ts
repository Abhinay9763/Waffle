export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "QuizForge";
export const APP_SHORT_NAME = process.env.NEXT_PUBLIC_APP_SHORT_NAME ?? "Waffle";
export const ORG_SHORT_NAME = process.env.NEXT_PUBLIC_ORG_SHORT_NAME ?? "SMEC";
export const ORG_DOMAIN = process.env.NEXT_PUBLIC_ORG_DOMAIN ?? "smec.ac.in";
export const LOGO = process.env.NEXT_PUBLIC_LOGO_PATH ?? "/logo.png";
export const LOGO_ALT = `${ORG_SHORT_NAME} logo`;
export const PAPER_TEMPLATE_FILE = process.env.NEXT_PUBLIC_PAPER_TEMPLATE_FILE ?? "question_paper_template.xlsx";

// Keep localhost fallback for local development.
export const API = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";
