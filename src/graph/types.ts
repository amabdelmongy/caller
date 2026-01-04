export type ConversationNode =
  | "start"
  | "initial_interest"
  | "other_property"
  | "price_range"
  | "bedrooms_bathrooms"
  | "kitchen_updates"
  | "property_condition"
  | "occupancy"
  | "lease_type"
  | "lease_expiry"
  | "selling_reason"
  | "collect_email"
  | "closing"
  | "end";

export interface GraphState {
  username: string;
  currentNode: ConversationNode;
  messages: Array<{ role: "ai" | "human"; content: string }>;
  answers: Record<string, string>;
  extractedAnswers: Record<string, any>; // Add this field for structured extracted values
  interestedInSelling: boolean | null;
  hasOtherProperty: boolean | null;
  isTenantOccupied: boolean | null;
  isAnnualLease: boolean | null;
  email: string | null;
  isComplete: boolean;
  lastQuestion: string;
  lastResponse: string;
}

export interface GraphLogEntry {
  timestamp: string;
  node: ConversationNode;
  question: string;
  userResponse: string;
  extractedValue: any;
  nextNode: ConversationNode;
}

export const QUESTIONS: Record<ConversationNode, string> = {
  start: "",
  initial_interest:
    "Hi, I'm calling you about the property, just wanted to ask if you've ever considered or had any intention of selling before?",
  other_property:
    "Alright, do you happen to have any other property you would like to sell?",
  price_range:
    "Great! May I ask you a few questions about the condition? Let me start by asking you if you have a price range in mind?",
  bedrooms_bathrooms: "How many bedrooms and bathrooms?",
  kitchen_updates:
    "Have you made any updates to the kitchen or bathrooms within the past 5 years?",
  property_condition:
    "On a scale of 1 to 10, how would you rate the condition of your property?",
  occupancy: "Is the property occupied by you or tenants (renters)?",
  lease_type: "May I ask, are they on a monthly lease or an annual lease?",
  lease_expiry: "When will the lease expire?",
  selling_reason: "What is the main reason for selling this property?",
  collect_email: "What's the best email address to send you more information?",
  closing:
    "I'd like to thank you for your time and the info. The next step is that one of our acquisition team will call you back to discuss the next step and follow up with you regarding our call within the next two business days. Can we reach you again on this number?",
  end: "",
};
