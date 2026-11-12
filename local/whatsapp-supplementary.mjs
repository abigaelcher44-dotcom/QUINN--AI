import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getWhatsAppAutomationConfig,
  updateWhatsAppAutomationConfig,
} from "./whatsapp-automation.mjs";
import {
  getWhatsAppConversationAIConfig,
  updateWhatsAppConversationAIConfig,
} from "./whatsapp-conversation.mjs";

const STORE = path.join(os.homedir(), ".quinn-ai", "whatsapp-supplementary.json");

let state = { phone: "" };

try {
  const saved = JSON.parse(fs.readFileSync(STORE, "utf8"));
  if (saved && typeof saved.phone === "string" && /^\d{7,15}$/.test(saved.phone)) {
    state.phone = saved.phone;
  }
} catch {
  // First run: no supplementary contact is configured.
}

function persist() {
  const directory = path.dirname(STORE);
  const temporary = `${STORE}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  try {
    fs.renameSync(temporary, STORE);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

export function getSupplementaryContactConfig() {
  return { phone: state.phone };
}

export function updateSupplementaryContactConfig(input) {
  const raw = String(input?.phone ?? "").trim();

  if (raw && !/^[+\d\s().-]+$/.test(raw)) {
    throw new Error("Enter a phone number using digits and ordinary phone-number separators only.");
  }

  const phone = raw.replace(/\D/g, "");
  if (raw && (phone.length < 7 || phone.length > 15)) {
    throw new Error("The phone number must contain between 7 and 15 digits.");
  }

  const previous = state;
  state = { phone };

  try {
    persist();
  } catch (error) {
    state = previous;
    throw error;
  }

  return getSupplementaryContactConfig();
}

export function handleSupplementaryCommand(item) {
  const jid = String(item?.jid || "");
  if (
    item?.fromMe === true ||
    !state.phone ||
    jid !== `${state.phone}@s.whatsapp.net`
  ) {
    return { handled: false };
  }

  const command = String(item?.text || "").trim().toUpperCase();
  if (command !== "HOME" && command !== "AWAY") {
    return { handled: false };
  }

  const enabled = command === "AWAY";
  const previousConversation = getWhatsAppConversationAIConfig();
  const previousAutomation = getWhatsAppAutomationConfig();

  try {
    updateWhatsAppAutomationConfig({
      ...previousAutomation,
      autoReply: {
        ...previousAutomation.autoReply,
        enabled,
      },
    });

    updateWhatsAppConversationAIConfig({ enabled });
  } catch (error) {
    try {
      updateWhatsAppConversationAIConfig(previousConversation);
    } catch (rollbackError) {
      console.error("[Supplementary contact] Conversational AI rollback failed:", rollbackError.message);
    }

    try {
      updateWhatsAppAutomationConfig(previousAutomation);
    } catch (rollbackError) {
      console.error("[Supplementary contact] Automation rollback failed:", rollbackError.message);
    }

    console.error("[Supplementary contact] Could not apply command:", error.message);
    return {
      handled: true,
      response: `Quinn could not safely apply ${command}. Please check the WhatsApp settings on the connected device.`,
    };
  }

  return {
    handled: true,
    response: enabled
      ? "AWAY confirmed. WhatsApp conversational AI and automatic replies are enabled, subject to their existing rules and approved-contact limits."
      : "HOME confirmed. WhatsApp conversational AI and automatic replies are paused.",
  };
}
