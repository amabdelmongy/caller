// import * as fs from "node:fs";
// import * as path from "node:path";

// export interface QuestionConfig {
//   id: string;
//   text: string;
//   required: boolean;
//   validationType?: "text" | "number" | "email" | "phone" | "date";
// }

// export const questionsConfig: QuestionConfig[] = [
//   {
//     id: "apartment_size",
//     text: "What is the total size of the apartment in m²?",
//     required: true,
//     validationType: "number",
//   },
//   {
//     id: "room_count",
//     text: "How many rooms does the apartment have?",
//     required: true,
//     validationType: "number",
//   },
//   {
//     id: "floor_number",
//     text: "Which floor is the apartment on?",
//     required: true,
//     validationType: "number",
//   },
// ];

// export function getQuestionTexts(): string[] {
//   return questionsConfig.map((q) => q.text);
// }

// export function getQuestionById(id: string): QuestionConfig | undefined {
//   return questionsConfig.find((q) => q.id === id);
// }

// // Optional: Load questions from JSON file
// export function loadQuestionsFromJson(jsonPath?: string): string[] {
//   const filePath = jsonPath ?? path.join(__dirname, "questions.json");
//   try {
//     const raw = fs.readFileSync(filePath, "utf8");
//     const data = JSON.parse(raw) as { questions: string[] };
//     return data.questions;
//   } catch {
//     return getQuestionTexts();
//   }
// }
