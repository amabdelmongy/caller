import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ExtractedAnswer, AnalysisResult } from "./types";

// Map questions to their expected value types
const questionTypeMap: Record<string, string> = {
  "Have you ever considered or had any intention of selling before?": "boolean",
  "Is selling something you may consider doing in the near future?": "boolean",
  "Do you happen to have any other property you would like to sell?": "boolean",
  "Do you have a price range in mind?": "currency",
  "Is this number negotiable?": "boolean",
  "What's your absolute bottom line in terms of price?": "currency",
  "What amount would you gladly walk away with?": "currency",
  "May I ask, how old is the roof?": "years",
  "Any issues in the foundation? Any cracks or leaks?": "condition",
  "How old is the HVAC (Heating, Ventilation, Air Conditioning system)? How old is the hot water heater? Any plumbing updates in the past 5 years?": "multi_value",
  "Have you made any updates to the kitchen or bathrooms within the past 5 years?": "boolean_detail",
  "Does the property need any kind of major or minor repairs or any cosmetic work that needs to be done?": "condition_detail",
  "How many bedrooms and bathrooms? How many car garages?": "room_count",
  "On a scale of 1 to 10, how would you rate the condition of your property?": "scale",
  "Is it currently listed with a realtor or is it off the market?": "listing_status",
  "Is the property occupied by you or tenants (renters)?": "occupancy",
  "Are the tenants on a monthly lease or an annual lease?": "lease_type",
  "When will the lease expire?": "date",
  "What is the main reason for selling this property?": "reason",
  "Is the property free and clear or do you still owe anything on it?": "mortgage_status",
  "If we could make the deal work, how soon do you think we can close the deal?": "timeline",
  "Can we reach you again on this number?": "boolean",
  "When's the best time we can call you back?": "time_preference",
  "What is your email address?": "email",
  "Do you know anyone else who might be interested in selling their property?": "referral",
};

function getExtractionPrompt(questionType: string): string {
  const prompts: Record<string, string> = {
    boolean: `Extract a yes/no/maybe answer.
      Response format: {"extractedValue": "yes" | "no" | "maybe", "valueType": "boolean"}`,

    currency: `Extract the dollar amount mentioned. Convert text like "two hundred thousand" to numbers.
      Response format: {"extractedValue": <number>, "valueType": "currency", "rawText": "<original text>"}
      Example: "Around 250k" → {"extractedValue": 250000, "valueType": "currency", "rawText": "250k"}`,

    years: `Extract the age in years.
      Response format: {"extractedValue": <number>, "valueType": "years"}
      Example: "About 5 years old" → {"extractedValue": 5, "valueType": "years"}`,

    condition: `Extract condition information - whether there are issues and what they are.
      Response format: {"extractedValue": "yes" | "no", "valueType": "condition", "details": "<specific issues if any>"}`,

    multi_value: `Extract multiple values: HVAC age, water heater age, and plumbing updates.
      Response format: {"extractedValue": {"hvacAge": <number|null>, "waterHeaterAge": <number|null>, "plumbingUpdated": <boolean|null>}, "valueType": "multi_value"}`,

    boolean_detail: `Extract yes/no and any details about updates made.
      Response format: {"extractedValue": "yes" | "no", "valueType": "boolean_detail", "details": "<what was updated>"}`,

    condition_detail: `Extract whether repairs are needed and categorize as major, minor, cosmetic, or none.
      Response format: {"extractedValue": "none" | "cosmetic" | "minor" | "major", "valueType": "condition_detail", "details": "<specific repairs needed>"}`,

    room_count: `Extract bedroom count, bathroom count, and garage count.
      Response format: {"extractedValue": {"bedrooms": <number>, "bathrooms": <number>, "garages": <number>}, "valueType": "room_count"}`,

    scale: `Extract a number from 1 to 10.
      Response format: {"extractedValue": <number 1-10>, "valueType": "scale"}`,

    listing_status: `Extract whether property is listed with realtor or off market.
      Response format: {"extractedValue": "listed" | "off_market" | "fsbo", "valueType": "listing_status", "realtorName": "<name if mentioned>"}`,

    occupancy: `Extract who occupies the property.
      Response format: {"extractedValue": "owner" | "tenant" | "vacant", "valueType": "occupancy"}`,

    lease_type: `Extract the lease type.
      Response format: {"extractedValue": "monthly" | "annual" | "other", "valueType": "lease_type"}`,

    date: `Extract the date or timeframe.
      Response format: {"extractedValue": "<date or timeframe>", "valueType": "date"}`,

    reason: `Extract the main reason for selling. Categorize if possible.
      Response format: {"extractedValue": "<category>", "valueType": "reason", "details": "<full explanation>"}
      Categories: relocation, downsizing, upsizing, financial, inheritance, divorce, retirement, investment, other`,

    mortgage_status: `Extract mortgage status - free and clear or amount owed.
      Response format: {"extractedValue": "free_and_clear" | "has_mortgage", "valueType": "mortgage_status", "amountOwed": <number|null>}`,

    timeline: `Extract the closing timeline.
      Response format: {"extractedValue": "<timeframe>", "valueType": "timeline", "daysEstimate": <number|null>}
      Example: "Within 2 months" → {"extractedValue": "2 months", "valueType": "timeline", "daysEstimate": 60}`,

    time_preference: `Extract preferred callback time.
      Response format: {"extractedValue": "<time preference>", "valueType": "time_preference"}`,

    email: `Extract the email address.
      Response format: {"extractedValue": "<email>", "valueType": "email"}`,

    referral: `Extract whether they have a referral and any details.
      Response format: {"extractedValue": "yes" | "no", "valueType": "referral", "details": "<name/contact if provided>"}`,
  };

  return prompts[questionType] || `Extract the key value from the answer.
    Response format: {"extractedValue": <value>, "valueType": "string"}`;
}

export async function analyzeAnswer(
  llm: ChatOpenAI,
  question: string,
  userAnswer: string,
): Promise<AnalysisResult> {
  try {
    // Determine question type
    const questionType = questionTypeMap[question] || "string";
    const extractionPrompt = getExtractionPrompt(questionType);

    const response = await llm.invoke([
      new SystemMessage(
        `You are a real estate data extraction assistant. Extract structured information from the homeowner's answer.

${extractionPrompt}

Always respond with valid JSON only. No additional text.
If you cannot extract a value, use null for extractedValue.`
      ),
      new HumanMessage(`Question: "${question}"\nHomeowner's answer: "${userAnswer}"`),
    ]);

    const content = (response.content ?? "").toString().trim();

    // Try to parse JSON, handle potential markdown code blocks
    let jsonContent = content;
    if (content.startsWith("```")) {
      jsonContent = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }

    const parsed = JSON.parse(jsonContent);

    const extractedAnswer: ExtractedAnswer = {
      question,
      fullAnswer: userAnswer,
      extractedValue: parsed.extractedValue ?? null,
      valueType: parsed.valueType || questionType,
      timestamp: new Date(),
      metadata: {
        details: parsed.details,
        rawText: parsed.rawText,
        amountOwed: parsed.amountOwed,
        daysEstimate: parsed.daysEstimate,
        realtorName: parsed.realtorName,
      },
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

// Helper to detect if user is asking a question (for rebuttal handling)
export function isUserAskingQuestion(message: string): boolean {
  const questionIndicators = [
    /\?$/,
    /^(who|what|where|when|why|how|can|could|would|will|is|are|do|does)\b/i,
    /^(tell me|explain|i want to know)/i,
  ];

  return questionIndicators.some(pattern => pattern.test(message.trim()));
}

// Helper to detect sentiment/interest level
export function detectInterestLevel(message: string): "high" | "medium" | "low" | "negative" {
  const lowerMessage = message.toLowerCase();

  const highInterest = /\b(yes|definitely|absolutely|interested|ready|asap|soon|let's do it)\b/;
  const mediumInterest = /\b(maybe|possibly|might|could|thinking|considering)\b/;
  const lowInterest = /\b(not sure|don't know|unlikely|probably not)\b/;
  const negative = /\b(no|never|not interested|stop calling|don't call|remove me)\b/;

  if (negative.test(lowerMessage)) return "negative";
  if (highInterest.test(lowerMessage)) return "high";
  if (mediumInterest.test(lowerMessage)) return "medium";
  if (lowInterest.test(lowerMessage)) return "low";

  return "medium"; // default
}
