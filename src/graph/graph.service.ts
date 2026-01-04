import { Injectable } from "@nestjs/common";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { GraphState, ConversationNode, QUESTIONS } from "./types";
import { LogsStorage } from "../logger/logs.storage";

// Define the state annotation for LangGraph
const GraphStateAnnotation = Annotation.Root({
  username: Annotation<string>,
  currentNode: Annotation<ConversationNode>,
  messages: Annotation<Array<{ role: "ai" | "human"; content: string }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  answers: Annotation<Record<string, string>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  extractedAnswers: Annotation<Record<string, any>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  interestedInSelling: Annotation<boolean | null>,
  hasOtherProperty: Annotation<boolean | null>,
  isTenantOccupied: Annotation<boolean | null>,
  isAnnualLease: Annotation<boolean | null>,
  email: Annotation<string | null>,
  isComplete: Annotation<boolean>,
  lastQuestion: Annotation<string>,
  lastResponse: Annotation<string>,
  nextNode: Annotation<ConversationNode>,
  extractedValue: Annotation<any>,
});

type GraphStateType = typeof GraphStateAnnotation.State;

// Add a type for validation results
interface ValidationResult {
  isValid: boolean;
  extractedValue: any;
  clarificationNeeded?: string;
}

@Injectable()
export class GraphService {
  private readonly llm: ChatOpenAI;
  private readonly activeStates = new Map<string, GraphState>();
  private graph: ReturnType<typeof this.buildGraph> | null = null;

  constructor(private readonly storage: LogsStorage) {
    this.llm = new ChatOpenAI({
      model: process.env.MODEL,
      apiKey: process.env.API_KEY,
      configuration: { baseURL: process.env.BASE_URL },
      temperature: 0,
    });
  }

  private buildGraph() {
    const workflow = new StateGraph(GraphStateAnnotation)
      .addNode("initial_interest", this.processInitialInterest.bind(this))
      .addNode("other_property", this.processOtherProperty.bind(this))
      .addNode("price_range", this.processPriceRange.bind(this))
      .addNode("bedrooms_bathrooms", this.processBedroomsBathrooms.bind(this))
      .addNode("kitchen_updates", this.processKitchenUpdates.bind(this))
      .addNode("property_condition", this.processPropertyCondition.bind(this))
      .addNode("occupancy", this.processOccupancy.bind(this))
      .addNode("lease_type", this.processLeaseType.bind(this))
      .addNode("lease_expiry", this.processLeaseExpiry.bind(this))
      .addNode("selling_reason", this.processSellingReason.bind(this))
      .addNode("collect_email", this.processEmail.bind(this))
      .addNode("closing", this.processClosing.bind(this))
      .addEdge(START, "initial_interest")
      .addConditionalEdges("initial_interest", (state) => {
        if (state.interestedInSelling === true) return "price_range";
        if (state.interestedInSelling === false) return "other_property";
        return "initial_interest";
      })
      .addConditionalEdges("other_property", (state) => {
        if (state.hasOtherProperty === true) return "price_range";
        return "closing";
      })
      .addEdge("price_range", "bedrooms_bathrooms")
      .addEdge("bedrooms_bathrooms", "kitchen_updates")
      .addEdge("kitchen_updates", "property_condition")
      .addEdge("property_condition", "occupancy")
      .addConditionalEdges("occupancy", (state) => {
        if (state.isTenantOccupied === true) return "lease_type";
        return "selling_reason";
      })
      .addConditionalEdges("lease_type", (state) => {
        if (state.isAnnualLease === true) return "lease_expiry";
        return "selling_reason";
      })
      .addEdge("lease_expiry", "selling_reason")
      .addEdge("selling_reason", "collect_email")
      .addEdge("collect_email", "closing")
      .addEdge("closing", END);

    return workflow.compile();
  }

  // Generic LLM extraction method
  private async extractWithLLM(
    response: string,
    extractionPrompt: string,
    schema: string
  ): Promise<ValidationResult> {
    try {
      const result = await this.llm.invoke([
        new SystemMessage(
          `You are a data extraction assistant for a real estate conversation.
Extract structured data from user responses and return ONLY valid JSON.

${extractionPrompt}

Expected JSON schema:
${schema}

Rules:
- Return {"isValid": true, "extractedValue": <extracted_data>} if you can extract the information
- Return {"isValid": false, "extractedValue": null, "clarificationNeeded": "<friendly clarification request>"} if the response is unclear or doesn't answer the question
- Be flexible with how users express themselves (slang, abbreviations, casual language)
- If the user seems to be saying yes/no in any form, extract it
- Always return valid JSON, nothing else`
        ),
        new HumanMessage(`User response: "${response}"`),
      ]);

      const content = (result.content ?? "").toString().trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isValid: parsed.isValid ?? false,
          extractedValue: parsed.extractedValue ?? null,
          clarificationNeeded: parsed.clarificationNeeded,
        };
      }
      return {
        isValid: false,
        extractedValue: null,
        clarificationNeeded: "I didn't quite understand that. Could you please rephrase?",
      };
    } catch (error) {
      console.error("[GraphService] LLM extraction error:", error);
      return {
        isValid: false,
        extractedValue: null,
        clarificationNeeded: "I had trouble understanding that. Could you please try again?",
      };
    }
  }

  // Node processors using LLM extraction
  private async processInitialInterest(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Determine if the user is interested in selling their property.
Look for any indication of yes/no, interest/disinterest, willingness to sell.
Examples of YES: "yes", "sure", "I'm thinking about it", "maybe", "I might be", "possibly", "I've been considering it"
Examples of NO: "no", "not really", "not interested", "no thanks", "I'm not selling"`,
      `{
  "isValid": boolean,
  "extractedValue": "yes" | "no" | null,
  "clarificationNeeded": string (optional, only if isValid is false)
}`
    );

    if (validation.isValid) {
      return {
        interestedInSelling: validation.extractedValue === "yes",
        extractedValue: validation.extractedValue,
      };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processOtherProperty(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Determine if the user has another property they might be interested in selling.
Look for any indication of yes/no regarding owning other properties.
Examples of YES: "yes", "I have another one", "I own a few", "there's my rental property"
Examples of NO: "no", "just this one", "that's my only property", "nope"`,
      `{
  "isValid": boolean,
  "extractedValue": "yes" | "no" | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      return {
        hasOtherProperty: validation.extractedValue === "yes",
        extractedValue: validation.extractedValue,
      };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processPriceRange(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Extract the price range or price expectation for the property.
Handle various formats: "$200k", "200000", "200 thousand", "around 300k", "between 200 and 300 thousand", "1.5 million", "1.5m"
Also handle: "not sure", "don't know", "need to think about it" as valid but uncertain responses.
Convert all prices to numbers (e.g., "200k" = 200000, "1.5m" = 1500000)`,
      `{
  "isValid": boolean,
  "extractedValue": {
    "min": number | null,
    "max": number | null,
    "raw": string,
    "status": "specified" | "not_sure"
  } | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processBedroomsBathrooms(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Extract the number of bedrooms and bathrooms.
Handle various formats: "3 bed 2 bath", "3/2", "three bedrooms two bathrooms", "3 bedrooms and 2.5 baths", "it's a 3/2"
Half bathrooms are valid (e.g., 2.5 bathrooms)`,
      `{
  "isValid": boolean,
  "extractedValue": {
    "bedrooms": number | null,
    "bathrooms": number | null,
    "raw": string
  } | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processKitchenUpdates(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Determine if the kitchen has been updated/renovated.
Examples of YES: "yes", "we renovated it", "it's new", "updated last year", "brand new kitchen"
Examples of NO: "no", "it's original", "needs work", "hasn't been touched", "it's outdated"`,
      `{
  "isValid": boolean,
  "extractedValue": "yes" | "no" | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processPropertyCondition(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Extract the property condition rating on a scale of 1-10.
Handle numeric responses: "8", "about a 7", "I'd say 6"
Handle descriptive responses and convert to scale:
- "excellent", "perfect", "like new" = 9-10
- "great", "very good" = 8
- "good" = 7
- "decent", "okay", "fair", "average" = 5-6
- "needs work", "needs some repairs" = 4
- "poor", "bad" = 2-3
- "terrible", "very bad" = 1`,
      `{
  "isValid": boolean,
  "extractedValue": number (1-10) | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processOccupancy(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Determine who currently occupies the property.
Categories:
- "tenant": renters, tenants, someone renting it, leased out
- "owner": owner-occupied, I live there, we live there, it's my home
- "vacant": empty, no one, vacant, unoccupied`,
      `{
  "isValid": boolean,
  "extractedValue": "tenant" | "owner" | "vacant" | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      const isTenant = validation.extractedValue === "tenant";
      return { isTenantOccupied: isTenant, extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processLeaseType(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Determine the type of lease agreement.
- "annual": yearly lease, 12-month lease, one year, annual agreement
- "monthly": month-to-month, MTM, monthly basis, no fixed term`,
      `{
  "isValid": boolean,
  "extractedValue": "annual" | "monthly" | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      const isAnnual = validation.extractedValue === "annual";
      return { isAnnualLease: isAnnual, extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processLeaseExpiry(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Extract when the lease expires.
Accept various formats:
- Dates: "March 2024", "3/15/24", "next month"
- Relative: "in 3 months", "end of year", "6 months from now"
- Approximate: "sometime next year", "around summer"`,
      `{
  "isValid": boolean,
  "extractedValue": string (the expiry date/timeframe) | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processSellingReason(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Extract the reason for selling the property.
Accept any reasonable explanation: relocating, downsizing, upgrading, financial reasons, investment, inheritance, divorce, retirement, etc.
The response should be meaningful (more than just "yes" or "no").`,
      `{
  "isValid": boolean,
  "extractedValue": string (the reason) | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processEmail(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = await this.extractWithLLM(
      state.lastResponse,
      `Extract the email address from the response.
- If a valid email is provided, extract it
- If the user declines ("no", "prefer not to", "skip", "don't have one"), return "declined"
- The email should be in standard format: something@domain.com`,
      `{
  "isValid": boolean,
  "extractedValue": string (email address or "declined") | null,
  "clarificationNeeded": string (optional)
}`
    );

    if (validation.isValid) {
      return { email: validation.extractedValue, extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processClosing(state: GraphStateType): Promise<Partial<GraphStateType>> {
    return { isComplete: true, extractedValue: state.lastResponse };
  }

  // ...existing code for chat, formatClarification, formatQuestion, determineNextNode, etc...

  async chat(username: string, userMessage: string): Promise<string> {
    let state = this.activeStates.get(username);

    if (!state) {
      state = this.storage.loadGraphState(username) ?? undefined;
      if (state) {
        this.activeStates.set(username, state);
      }
    }

    if (!state) {
      const initialState: GraphState = {
        username,
        currentNode: "initial_interest",
        messages: [],
        answers: {},
        extractedAnswers: {},
        interestedInSelling: null,
        hasOtherProperty: null,
        isTenantOccupied: null,
        isAnnualLease: null,
        email: null,
        isComplete: false,
        lastQuestion: QUESTIONS.initial_interest,
        lastResponse: "",
      };

      const aiMessage = QUESTIONS.initial_interest;
      initialState.messages.push({ role: "ai", content: aiMessage });

      this.activeStates.set(username, initialState);
      this.storage.saveGraphState(initialState);

      console.log(`[GraphService] New conversation started for ${username}`);
      console.log(`[GraphService] Initial question: ${aiMessage}`);

      return aiMessage;
    }

    if (state.isComplete) {
      console.log(`[GraphService] Conversation already complete for ${username}`);
      return "The conversation has ended. Please start a new conversation.";
    }

    console.log(`[GraphService] Received message from ${username}: "${userMessage}"`);
    console.log(`[GraphService] Current node: ${state.currentNode}`);

    state.messages.push({ role: "human", content: userMessage });
    state.lastResponse = userMessage;

    try {
      const processorResult = await this.processCurrentNode(state.currentNode, {
        ...state,
        extractedAnswers: state.extractedAnswers || {},
        nextNode: state.currentNode,
        extractedValue: null,
      });

      const extractedValue = processorResult.extractedValue;

      console.log(`[GraphService] Extracted value for ${state.currentNode}:`, JSON.stringify(extractedValue));

      if (extractedValue && typeof extractedValue === "object" && extractedValue.unclear) {
        console.log(`[GraphService] Unclear response, asking for clarification`);

        const clarificationMessage = await this.formatClarification(
          state,
          extractedValue.clarification || QUESTIONS[state.currentNode]
        );

        this.storage.appendGraphLog(
          username,
          state.currentNode,
          QUESTIONS[state.currentNode],
          userMessage,
          { unclear: true, originalResponse: userMessage, clarification: extractedValue.clarification },
          state.currentNode,
          clarificationMessage
        );

        state.messages.push({ role: "ai", content: clarificationMessage });

        this.activeStates.set(username, state);
        this.storage.saveGraphState(state);

        return clarificationMessage;
      }

      const updatedState = {
        ...state,
        interestedInSelling: processorResult.interestedInSelling ?? state.interestedInSelling,
        hasOtherProperty: processorResult.hasOtherProperty ?? state.hasOtherProperty,
        isTenantOccupied: processorResult.isTenantOccupied ?? state.isTenantOccupied,
        isAnnualLease: processorResult.isAnnualLease ?? state.isAnnualLease,
        email: processorResult.email ?? state.email,
      };

      const previousNode = state.currentNode;
      const nextNode = this.determineNextNode(state.currentNode, updatedState as any);
      const extractedValueFinal = processorResult.extractedValue;

      state.answers[previousNode] = userMessage;

      if (!state.extractedAnswers) {
        state.extractedAnswers = {};
      }
      state.extractedAnswers[previousNode] = extractedValueFinal;

      console.log(`[GraphService] Node transition: ${previousNode} -> ${nextNode}`);
      console.log(`[GraphService] Raw answer saved: "${userMessage}"`);
      console.log(`[GraphService] Extracted value saved:`, JSON.stringify(extractedValueFinal));

      state.interestedInSelling = updatedState.interestedInSelling;
      state.hasOtherProperty = updatedState.hasOtherProperty;
      state.isTenantOccupied = updatedState.isTenantOccupied;
      state.isAnnualLease = updatedState.isAnnualLease;
      state.email = updatedState.email;

      state.currentNode = nextNode;

      let aiResponseMessage = "";

      if (nextNode === "end" || nextNode === "closing") {
        state.isComplete = true;
        aiResponseMessage = "Thank you for your time. Our team will be in touch soon. Have a great day!";
        state.messages.push({ role: "ai", content: aiResponseMessage });
        state.lastQuestion = aiResponseMessage;

        this.logConversationSummary(username, state);
      } else {
        const nextQuestion = QUESTIONS[nextNode];
        if (nextQuestion) {
          aiResponseMessage = await this.formatQuestion(state, nextQuestion);
          state.messages.push({ role: "ai", content: aiResponseMessage });
          state.lastQuestion = nextQuestion;

          console.log(`[GraphService] Next question (${nextNode}): ${aiResponseMessage}`);
        } else {
          console.error(`[GraphService] No question found for node: ${nextNode}`);
          state.isComplete = true;
          aiResponseMessage = "Thank you for your time. Our team will be in touch soon. Have a great day!";
          state.messages.push({ role: "ai", content: aiResponseMessage });

          this.logConversationSummary(username, state);
        }
      }

      this.storage.appendGraphLog(
        username,
        previousNode,
        QUESTIONS[previousNode],
        userMessage,
        extractedValueFinal,
        nextNode,
        aiResponseMessage
      );

      this.activeStates.set(username, state);
      this.storage.saveGraphState(state);

      return state.messages[state.messages.length - 1].content;
    } catch (error) {
      console.error("[GraphService] Error processing node:", error);
      return this.processFallback(username, state, userMessage);
    }
  }

  private logConversationSummary(username: string, state: GraphState): void {
    console.log(`\n========== CONVERSATION SUMMARY: ${username} ==========`);
    console.log(`Completed: ${state.isComplete}`);
    console.log(`\nRaw Answers:`);
    for (const [node, answer] of Object.entries(state.answers)) {
      console.log(`  ${node}: "${answer}"`);
    }
    console.log(`\nExtracted Values:`);
    for (const [node, value] of Object.entries(state.extractedAnswers || {})) {
      console.log(`  ${node}:`, JSON.stringify(value));
    }
    console.log(`\nState Flags:`);
    console.log(`  interestedInSelling: ${state.interestedInSelling}`);
    console.log(`  hasOtherProperty: ${state.hasOtherProperty}`);
    console.log(`  isTenantOccupied: ${state.isTenantOccupied}`);
    console.log(`  isAnnualLease: ${state.isAnnualLease}`);
    console.log(`  email: ${state.email}`);
    console.log(`=======================================================\n`);

    this.storage.appendGraphSummary(username, state);
  }

  private async processCurrentNode(
    node: ConversationNode,
    state: GraphStateType
  ): Promise<Partial<GraphStateType>> {
    switch (node) {
      case "initial_interest":
        return this.processInitialInterest(state);
      case "other_property":
        return this.processOtherProperty(state);
      case "price_range":
        return this.processPriceRange(state);
      case "bedrooms_bathrooms":
        return this.processBedroomsBathrooms(state);
      case "kitchen_updates":
        return this.processKitchenUpdates(state);
      case "property_condition":
        return this.processPropertyCondition(state);
      case "occupancy":
        return this.processOccupancy(state);
      case "lease_type":
        return this.processLeaseType(state);
      case "lease_expiry":
        return this.processLeaseExpiry(state);
      case "selling_reason":
        return this.processSellingReason(state);
      case "collect_email":
        return this.processEmail(state);
      case "closing":
        return this.processClosing(state);
      default:
        return { extractedValue: state.lastResponse };
    }
  }

  private async formatClarification(state: GraphState, clarification: string): Promise<string> {
    const recentHistory = state.messages
      .slice(-2)
      .map((m) => `${m.role === "ai" ? "Agent" : "Homeowner"}: ${m.content}`)
      .join("\n");

    try {
      const response = await this.llm.invoke([
        new SystemMessage(
          `You are a professional real estate caller. The user's response was unclear.
Politely ask for clarification in a natural, conversational way.
Be brief and friendly. Don't be repetitive.

Recent conversation:
${recentHistory}`
        ),
        new HumanMessage(`Ask this clarification naturally: ${clarification}`),
      ]);

      return (response.content ?? "").toString().trim() || clarification;
    } catch {
      return clarification;
    }
  }

  private determineNextNode(currentNode: ConversationNode, result: GraphStateType): ConversationNode {
    switch (currentNode) {
      case "initial_interest":
        if (result.interestedInSelling === true) return "price_range";
        if (result.interestedInSelling === false) return "other_property";
        return "initial_interest";
      case "other_property":
        if (result.hasOtherProperty === true) return "price_range";
        return "closing";
      case "price_range":
        return "bedrooms_bathrooms";
      case "bedrooms_bathrooms":
        return "kitchen_updates";
      case "kitchen_updates":
        return "property_condition";
      case "property_condition":
        return "occupancy";
      case "occupancy":
        if (result.isTenantOccupied === true) return "lease_type";
        return "selling_reason";
      case "lease_type":
        if (result.isAnnualLease === true) return "lease_expiry";
        return "selling_reason";
      case "lease_expiry":
        return "selling_reason";
      case "selling_reason":
        return "collect_email";
      case "collect_email":
        return "closing";
      case "closing":
        return "end";
      default:
        return "end";
    }
  }

  private async processFallback(username: string, state: GraphState, userMessage: string): Promise<string> {
    const previousNode = state.currentNode;
    const nextNode = this.determineNextNode(state.currentNode, state as any);

    state.answers[previousNode] = userMessage;
    state.currentNode = nextNode;

    if (nextNode === "end" || nextNode === "closing") {
      state.isComplete = true;
      const msg = "Thank you for your time. Our team will be in touch soon. Have a great day!";
      state.messages.push({ role: "ai", content: msg });
    } else {
      const nextQuestion = QUESTIONS[nextNode];
      if (nextQuestion) {
        state.messages.push({ role: "ai", content: nextQuestion });
        state.lastQuestion = nextQuestion;
      } else {
        state.isComplete = true;
        const msg = "Thank you for your time. Our team will be in touch soon. Have a great day!";
        state.messages.push({ role: "ai", content: msg });
      }
    }

    this.activeStates.set(username, state);
    this.storage.saveGraphState(state);

    return state.messages[state.messages.length - 1].content;
  }

  private async formatQuestion(state: GraphState, question: string): Promise<string> {
    if (!question) return "";

    const recentHistory = state.messages
      .slice(-4)
      .map((m) => `${m.role === "ai" ? "Agent" : "Homeowner"}: ${m.content}`)
      .join("\n");

    try {
      const response = await this.llm.invoke([
        new SystemMessage(
          `You are a professional real estate caller. Ask the next question naturally, acknowledging the conversation context.
Keep it conversational and professional. Be brief and natural.

Recent conversation:
${recentHistory}`
        ),
        new HumanMessage(`Ask this question naturally: ${question}`),
      ]);

      return (response.content ?? "").toString().trim() || question;
    } catch {
      return question;
    }
  }

  async resetConversation(username: string): Promise<void> {
    this.activeStates.delete(username);
    this.storage.clearGraphState(username);
  }

  getConversationState(username: string): GraphState | null {
    return this.activeStates.get(username) ?? this.storage.loadGraphState(username);
  }
}
