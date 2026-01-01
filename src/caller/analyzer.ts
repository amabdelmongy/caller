import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ExtractedAnswer, AnalysisResult } from "./types";

export async function analyzeAnswer(
  llm: ChatOpenAI,
  question: string,
  userAnswer: string,
): Promise<AnalysisResult> {
  try {
    const response = await llm.invoke([
      new SystemMessage(
        `You are a data extraction assistant. Extract the numeric or key value from the user's answer to the given question.
        Respond ONLY with a JSON object in this format:
        {"extractedValue": <number or string>, "valueType": "number" | "string"}

        Examples:
        - Question: "How many rooms?" Answer: "I have 3 bedrooms" → {"extractedValue": 3, "valueType": "number"}
        - Question: "Total size in m²?" Answer: "About 85 square meters" → {"extractedValue": 85, "valueType": "number"}
        - Question: "Which floor?" Answer: "Fifth floor" → {"extractedValue": 5, "valueType": "number"}`
      ),
      new HumanMessage(`Question: "${question}"\nUser's answer: "${userAnswer}"`),
    ]);

    const content = (response.content ?? "").toString().trim();
    const parsed = JSON.parse(content);

    const extractedAnswer: ExtractedAnswer = {
      question,
      fullAnswer: userAnswer,
      extractedValue: parsed.extractedValue ?? null,
      valueType: parsed.valueType || "unknown",
      timestamp: new Date(),
    };

    return {
      success: true,
      data: extractedAnswer,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    const extractedAnswer: ExtractedAnswer = {
      question,
      fullAnswer: userAnswer,
      extractedValue: null,
      valueType: "unknown",
      timestamp: new Date(),
    };
    return {
      success: false,
      data: extractedAnswer,
      error: errorMessage,
    };
  }
}
