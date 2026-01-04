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

// Add interface for price extraction result
interface PriceExtractionResult {
  raw: string;
  min: number | null;
  max: number | null;
  currency: string;
}

// Add interface for bedrooms/bathrooms extraction
interface BedroomsBathroomsResult {
  bedrooms: number | null;
  bathrooms: number | null;
  raw: string;
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
      // Add all nodes
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

      // Add edges from START
      .addEdge(START, "initial_interest")

      // Add conditional edges based on node outcomes
      .addConditionalEdges("initial_interest", (state) => {
        if (state.interestedInSelling === true) return "price_range";
        if (state.interestedInSelling === false) return "other_property";
        return "initial_interest"; // Ask again if unclear
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

  // Node processors with validation
  private async processInitialInterest(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateYesNo(state.lastResponse);
    if (validation.isValid) {
      return {
        interestedInSelling: validation.extractedValue === "yes",
        extractedValue: validation.extractedValue
      };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processOtherProperty(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateYesNo(state.lastResponse);
    if (validation.isValid) {
      return {
        hasOtherProperty: validation.extractedValue === "yes",
        extractedValue: validation.extractedValue
      };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processPriceRange(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validatePriceRange(state.lastResponse);
    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processBedroomsBathrooms(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateBedroomsBathrooms(state.lastResponse);
    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processKitchenUpdates(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateYesNo(state.lastResponse);
    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processPropertyCondition(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateScale(state.lastResponse);
    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processOccupancy(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateOccupancy(state.lastResponse);
    if (validation.isValid) {
      const isTenant = validation.extractedValue === "tenant";
      return { isTenantOccupied: isTenant, extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processLeaseType(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateLeaseType(state.lastResponse);
    if (validation.isValid) {
      const isAnnual = validation.extractedValue === "annual";
      return { isAnnualLease: isAnnual, extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processLeaseExpiry(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateDate(state.lastResponse);
    if (validation.isValid) {
      return { extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processSellingReason(state: GraphStateType): Promise<Partial<GraphStateType>> {
    // Accept any non-empty response for selling reason
    if (state.lastResponse.trim().length > 2) {
      return { extractedValue: state.lastResponse };
    }
    return { extractedValue: { unclear: true, clarification: "Could you tell me more about why you're considering selling?" } };
  }

  private async processEmail(state: GraphStateType): Promise<Partial<GraphStateType>> {
    const validation = this.validateEmail(state.lastResponse);
    if (validation.isValid) {
      return { email: validation.extractedValue, extractedValue: validation.extractedValue };
    }
    return { extractedValue: { unclear: true, clarification: validation.clarificationNeeded } };
  }

  private async processClosing(state: GraphStateType): Promise<Partial<GraphStateType>> {
    return { isComplete: true, extractedValue: state.lastResponse };
  }

  // Validation helper methods
  private validateYesNo(response: string): ValidationResult {
    const userMessage = response.toLowerCase().trim();
    const isYes = /\b(yes|yeah|sure|definitely|absolutely|yep|yup|correct|right|true|i do|i am|i have)\b/i.test(userMessage);
    const isNo = /\b(no|nope|not really|never|nah|negative|i don't|i haven't|not yet)\b/i.test(userMessage);

    if (isYes) return { isValid: true, extractedValue: "yes" };
    if (isNo) return { isValid: true, extractedValue: "no" };

    return {
      isValid: false,
      extractedValue: null,
      clarificationNeeded: "I didn't quite catch that. Could you please answer with yes or no?"
    };
  }

  private parsePriceToNumber(priceStr: string): number | null {
    if (!priceStr) return null;

    // Remove currency symbols, commas, and whitespace
    let cleaned = priceStr.replace(/[$,\s]/g, '').toLowerCase();

    // Handle 'k' suffix (e.g., "200k" -> 200000)
    if (cleaned.endsWith('k')) {
      const num = parseFloat(cleaned.slice(0, -1));
      return isNaN(num) ? null : num * 1000;
    }

    // Handle 'm' or 'million' suffix (e.g., "1.5m" -> 1500000)
    if (cleaned.endsWith('m') || cleaned.includes('million')) {
      cleaned = cleaned.replace('million', '').replace('m', '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num * 1000000;
    }

    // Handle 'thousand' suffix
    if (cleaned.includes('thousand')) {
      cleaned = cleaned.replace('thousand', '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num * 1000;
    }

    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  private extractPriceRange(response: string): PriceExtractionResult {
    const result: PriceExtractionResult = {
      raw: response,
      min: null,
      max: null,
      currency: 'USD'
    };

    // Pattern for range: "$200k - $300k", "200000 to 300000", "between 200k and 300k"
    const rangePatterns = [
      /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:k|K|thousand|m|M|million)?\s*(?:-|to|and)\s*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:k|K|thousand|m|M|million)?/i,
      /between\s*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:k|K|thousand|m|M|million)?\s*(?:and|to)\s*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:k|K|thousand|m|M|million)?/i,
    ];

    for (const pattern of rangePatterns) {
      const match = response.match(pattern);
      if (match) {
        // Get the suffixes for each number
        const fullMatch = match[0];
        const firstPart = fullMatch.substring(0, fullMatch.search(/(-|to|and)/i));
        const secondPart = fullMatch.substring(fullMatch.search(/(-|to|and)/i));

        result.min = this.parsePriceToNumber(firstPart);
        result.max = this.parsePriceToNumber(secondPart);
        return result;
      }
    }

    // Pattern for single price: "$200k", "200000", "around 300k"
    const singlePatterns = [
      /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:k|K|thousand)?/,
      /\$?\s*(\d+)\s*(?:k|K|thousand)/,
      /(\d{1,3}(?:,\d{3})*)\s*(?:dollars?)?/,
      /(?:around|about|approximately|roughly)\s*\$?\s*(\d+)\s*(?:k|K|thousand|m|M|million)?/i,
    ];

    for (const pattern of singlePatterns) {
      const match = response.match(pattern);
      if (match) {
        const price = this.parsePriceToNumber(match[0]);
        if (price !== null) {
          result.min = price;
          result.max = price;
          return result;
        }
      }
    }

    return result;
  }

  private validatePriceRange(response: string): ValidationResult {
    // Check if they're unsure first
    if (/\b(not sure|don't know|no idea|unsure|haven't decided)\b/i.test(response)) {
      return {
        isValid: true,
        extractedValue: {
          raw: response,
          min: null,
          max: null,
          currency: 'USD',
          status: 'not_sure'
        }
      };
    }

    const priceResult = this.extractPriceRange(response);

    if (priceResult.min !== null || priceResult.max !== null) {
      return {
        isValid: true,
        extractedValue: priceResult
      };
    }

    return {
      isValid: false,
      extractedValue: null,
      clarificationNeeded: "Could you give me a rough price range you have in mind? For example, $200,000 or around $300k?"
    };
  }

  private validateBedroomsBathrooms(response: string): ValidationResult {
    const result: BedroomsBathroomsResult = {
      bedrooms: null,
      bathrooms: null,
      raw: response
    };

    // Match patterns like "3 bed 2 bath", "3 bedrooms 2 bathrooms", "3/2", "3 and 2"
    const patterns = [
      /(\d+)\s*(?:bed(?:room)?s?|br)\s*(?:and|,|\/|\s)\s*(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|ba)/i,
      /(\d+)\s*\/\s*(\d+(?:\.\d+)?)/,
      /(\d+)\s+(\d+(?:\.\d+)?)/,
    ];

    for (const pattern of patterns) {
      const match = response.match(pattern);
      if (match) {
        result.bedrooms = parseInt(match[1], 10);
        result.bathrooms = parseFloat(match[2]);
        return { isValid: true, extractedValue: result };
      }
    }

    // Try to match just bedrooms
    const bedroomMatch = response.match(/(\d+)\s*(?:bed(?:room)?s?|br)/i);
    if (bedroomMatch) {
      result.bedrooms = parseInt(bedroomMatch[1], 10);
    }

    // Try to match just bathrooms
    const bathroomMatch = response.match(/(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|ba)/i);
    if (bathroomMatch) {
      result.bathrooms = parseFloat(bathroomMatch[1]);
    }

    if (result.bedrooms !== null || result.bathrooms !== null) {
      return { isValid: true, extractedValue: result };
    }

    // Try simple number extraction if format mentions beds/baths context
    const numbers = response.match(/\d+(?:\.\d+)?/g);
    if (numbers && numbers.length >= 2) {
      result.bedrooms = parseInt(numbers[0], 10);
      result.bathrooms = parseFloat(numbers[1]);
      return { isValid: true, extractedValue: result };
    }

    return {
      isValid: false,
      extractedValue: null,
      clarificationNeeded: "Could you tell me how many bedrooms and bathrooms the property has? For example, '3 bedrooms and 2 bathrooms'."
    };
  }

  private validateScale(response: string): ValidationResult {
    const scaleMatch = response.match(/\b([1-9]|10)\b/);
    if (scaleMatch) {
      return { isValid: true, extractedValue: parseInt(scaleMatch[1]) };
    }

    // Handle word descriptions
    const conditionWords: Record<string, number> = {
      'excellent': 10, 'perfect': 10, 'great': 9, 'very good': 8,
      'good': 7, 'decent': 6, 'okay': 5, 'ok': 5, 'fair': 5,
      'average': 5, 'needs work': 4, 'poor': 3, 'bad': 2, 'terrible': 1
    };

    const lowerResponse = response.toLowerCase();
    for (const [word, value] of Object.entries(conditionWords)) {
      if (lowerResponse.includes(word)) {
        return { isValid: true, extractedValue: value };
      }
    }

    return {
      isValid: false,
      extractedValue: null,
      clarificationNeeded: "Could you rate the condition on a scale of 1 to 10, where 10 is excellent and 1 is poor?"
    };
  }

  private validateOccupancy(response: string): ValidationResult {
    const lowerResponse = response.toLowerCase();

    if (/\b(tenant|renter|rent|leased|renting)\b/i.test(lowerResponse)) {
      return { isValid: true, extractedValue: "tenant" };
    }
    if (/\b(owner|myself|me|i live|we live|occupied by me|my home|vacant|empty)\b/i.test(lowerResponse)) {
      return { isValid: true, extractedValue: "owner" };
    }

    return {
      isValid: false,
      extractedValue: null,
      clarificationNeeded: "Is the property currently occupied by you, or do you have tenants renting it?"
    };
  }

  private validateLeaseType(response: string): ValidationResult {
    const lowerResponse = response.toLowerCase();

    if (/\b(annual|year|yearly|12 month|one year)\b/i.test(lowerResponse)) {
      return { isValid: true, extractedValue: "annual" };
    }
    if (/\b(month|monthly|month-to-month|mtm)\b/i.test(lowerResponse)) {
      return { isValid: true, extractedValue: "monthly" };
    }

    return {
      isValid: false,
      extractedValue: null,
      clarificationNeeded: "Is it an annual lease or a month-to-month arrangement?"
    };
  }

  private validateDate(response: string): ValidationResult {
    // Match various date formats
    const datePatterns = [
      /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/,
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{1,2}?,?\s*\d{2,4}?\b/i,
      /\b(\d{1,2})\s*(months?|weeks?|days?)\b/i,
      /\b(next month|next year|end of year|soon)\b/i,
    ];

    for (const pattern of datePatterns) {
      const match = response.match(pattern);
      if (match) {
        return { isValid: true, extractedValue: match[0] };
      }
    }

    // Accept general timeframe responses
    if (response.trim().length > 2) {
      return { isValid: true, extractedValue: response };
    }

    return {
      isValid: false,
      extractedValue: null,
      clarificationNeeded: "When does the current lease expire? You can give me a date or approximate timeframe."
    };
  }

  private validateEmail(response: string): ValidationResult {
    const emailMatch = response.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      return { isValid: true, extractedValue: emailMatch[0] };
    }

    // Check if they declined to provide email
    if (/\b(no|none|don't have|prefer not|skip)\b/i.test(response.toLowerCase())) {
      return { isValid: true, extractedValue: "declined" };
    }

    return {
      isValid: false,
      extractedValue: null,
      clarificationNeeded: "Could you please provide a valid email address? For example, yourname@example.com"
    };
  }

  // Update the chat method to handle unclear responses
  async chat(username: string, userMessage: string): Promise<string> {
    let state = this.activeStates.get(username);

    if (!state) {
      state = this.storage.loadGraphState(username) ?? undefined;
      if (state) {
        this.activeStates.set(username, state);
      }
    }

    // If no state exists, start a new conversation
    if (!state) {
      const initialState: GraphState = {
        username,
        currentNode: "initial_interest",
        messages: [],
        answers: {},
        extractedAnswers: {}, // Initialize extracted answers
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

      // Log the initial question
      console.log(`[GraphService] New conversation started for ${username}`);
      console.log(`[GraphService] Initial question: ${aiMessage}`);

      return aiMessage;
    }

    if (state.isComplete) {
      console.log(`[GraphService] Conversation already complete for ${username}`);
      return "The conversation has ended. Please start a new conversation.";
    }

    // Log incoming message
    console.log(`[GraphService] Received message from ${username}: "${userMessage}"`);
    console.log(`[GraphService] Current node: ${state.currentNode}`);

    // Add user message to history
    state.messages.push({ role: "human", content: userMessage });
    state.lastResponse = userMessage;

    try {
      // Process the current node directly instead of invoking the full graph
      const processorResult = await this.processCurrentNode(state.currentNode, {
        ...state,
        extractedAnswers: state.extractedAnswers || {},
        nextNode: state.currentNode,
        extractedValue: null,
      });

      const extractedValue = processorResult.extractedValue;

      // Log the extraction result
      console.log(`[GraphService] Extracted value for ${state.currentNode}:`, JSON.stringify(extractedValue));

      // Check if the response was unclear and needs re-asking
      if (extractedValue && typeof extractedValue === 'object' && extractedValue.unclear) {
        console.log(`[GraphService] Unclear response, asking for clarification`);

        // Don't advance to next node, re-ask with clarification
        const clarificationMessage = await this.formatClarification(
          state,
          extractedValue.clarification || QUESTIONS[state.currentNode]
        );

        // Log the unclear response to file WITH the AI response
        this.storage.appendGraphLog(
          username,
          state.currentNode,
          QUESTIONS[state.currentNode],
          userMessage,
          { unclear: true, originalResponse: userMessage, clarification: extractedValue.clarification },
          state.currentNode, // stays on same node
          clarificationMessage // AI response
        );

        state.messages.push({ role: "ai", content: clarificationMessage });

        this.activeStates.set(username, state);
        this.storage.saveGraphState(state);

        return clarificationMessage;
      }

      // Merge processor result into state
      const updatedState = {
        ...state,
        interestedInSelling: processorResult.interestedInSelling ?? state.interestedInSelling,
        hasOtherProperty: processorResult.hasOtherProperty ?? state.hasOtherProperty,
        isTenantOccupied: processorResult.isTenantOccupied ?? state.isTenantOccupied,
        isAnnualLease: processorResult.isAnnualLease ?? state.isAnnualLease,
        email: processorResult.email ?? state.email,
      };

      // Determine next node from result
      const previousNode = state.currentNode;
      const nextNode = this.determineNextNode(state.currentNode, updatedState as any);
      const extractedValueFinal = processorResult.extractedValue;

      // Save answer for the CURRENT node (before updating)
      state.answers[previousNode] = userMessage;

      // Save extracted value separately
      if (!state.extractedAnswers) {
        state.extractedAnswers = {};
      }
      state.extractedAnswers[previousNode] = extractedValueFinal;

      // Log the transition
      console.log(`[GraphService] Node transition: ${previousNode} -> ${nextNode}`);
      console.log(`[GraphService] Raw answer saved: "${userMessage}"`);
      console.log(`[GraphService] Extracted value saved:`, JSON.stringify(extractedValueFinal));

      // Update state with new values
      state.interestedInSelling = updatedState.interestedInSelling;
      state.hasOtherProperty = updatedState.hasOtherProperty;
      state.isTenantOccupied = updatedState.isTenantOccupied;
      state.isAnnualLease = updatedState.isAnnualLease;
      state.email = updatedState.email;

      // Now update to the next node
      state.currentNode = nextNode;

      let aiResponseMessage = "";

      if (nextNode === "end" || nextNode === "closing") {
        state.isComplete = true;
        aiResponseMessage = "Thank you for your time. Our team will be in touch soon. Have a great day!";
        state.messages.push({ role: "ai", content: aiResponseMessage });
        state.lastQuestion = aiResponseMessage;

        // Log completion summary
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

          // Log completion summary
          this.logConversationSummary(username, state);
        }
      }

      // Log the interaction to file WITH the AI response
      this.storage.appendGraphLog(
        username,
        previousNode,
        QUESTIONS[previousNode],
        userMessage,
        extractedValueFinal,
        nextNode,
        aiResponseMessage // AI response that will be returned to API
      );

      this.activeStates.set(username, state);
      this.storage.saveGraphState(state);

      return state.messages[state.messages.length - 1].content;
    } catch (error) {
      console.error("[GraphService] Error processing node:", error);
      return this.processFallback(username, state, userMessage);
    }
  }

  // Add method to log conversation summary
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

    // Also save summary to log file
    this.storage.appendGraphSummary(username, state);
  }

  // Add method to process current node directly
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
    // Simple fallback processing without graph
    const previousNode = state.currentNode;
    const nextNode = this.determineNextNode(state.currentNode, state as any);

    // Save answer for current node before updating
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
