import express from "express";
import fetch from "node-fetch";
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
console.log("SERVER VERSION: slot-debug-v1");

// לשלב הבא: כתובת ה-API של האפליקציה שלך
// לדוגמה: https://rehab-dent-admin.base44.app
const APP_API_BASE_URL = "https://69b792dd54c7935ae7606aaa.base44.app";

if (!BOT_TOKEN) {
  throw new Error("Missing BOT_TOKEN environment variable");
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ---------------------------
// Telegram helpers
// ---------------------------

async function telegramRequest(method, payload) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    console.error(`Telegram API error on ${method}:`, data);
    throw new Error(`Telegram API request failed: ${method}`);
  }

  return data;
}

async function sendMessage(chatId, text, replyMarkup = undefined) {
  const payload = {
    chat_id: chatId,
    text,
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return telegramRequest("sendMessage", payload);
}

async function editMessage(chatId, messageId, text, replyMarkup = undefined) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  return telegramRequest("editMessageText", payload);
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  return telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

function inlineKeyboard(rows) {
  return {
    inline_keyboard: rows,
  };
}

// ---------------------------
// UI text
// ---------------------------

const START_TEXT = `שלום,
ברוך הבא למערכת זימון התורים של המחלקה לשיקום הפה.

כיצד נוכל לעזור לך?`;

function mainMenuKeyboard() {
  return inlineKeyboard([
    [{ text: "קביעת בדיקה שיקומית", callback_data: "flow:rehab_exam" }],
    [{ text: "קביעת תור אצל רופא משקם", callback_data: "flow:rehab_doctor" }],
    [{ text: "קביעת תור המשך טיפול", callback_data: "flow:rehab_followup" }],
  ]);
}

function yesNoNotSureKeyboard(prefix) {
  return inlineKeyboard([
    [
      { text: "כן", callback_data: `${prefix}:yes` },
      { text: "לא", callback_data: `${prefix}:no` },
      { text: "לא בטוח", callback_data: `${prefix}:unsure` },
    ],
    [{ text: "חזרה לתפריט הראשי", callback_data: "nav:main" }],
  ]);
}

function yesDontRememberKeyboard(prefix) {
  return inlineKeyboard([
    [
      { text: "כן", callback_data: `${prefix}:yes` },
      { text: "לא זוכר", callback_data: `${prefix}:dont_remember` },
    ],
    [{ text: "חזרה לתפריט הראשי", callback_data: "nav:main" }],
  ]);
}

function backToMainKeyboard() {
  return inlineKeyboard([
    [{ text: "חזרה לתפריט הראשי", callback_data: "nav:main" }],
  ]);
}

// ---------------------------
// Optional bridge to your app
// ---------------------------

async function fetchAvailableSlots(flowType) {
  if (!APP_API_BASE_URL) {
    console.log("APP_API_BASE_URL missing");
    return [];
  }

  try {
    const url = `${APP_API_BASE_URL}/api/apps/69b792dd54c7935ae7606aaa/functions/getAvailableSlots`;
    console.log("Fetching slots from:", url);
    console.log("FLOW TYPE:", flowType);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        flow_type: flowType,
      }),
    });

    const text = await res.text();

    console.log("HTTP status:", res.status);
    console.log("Raw response preview:", text.slice(0, 300));

    if (!res.ok) {
      console.error("Failed to fetch slots from app:", text);
      return [];
    }

  let parsed;

try {
  parsed = JSON.parse(text);
} catch (err) {
  console.error("Failed to parse JSON response:", err);
  console.log("Full raw response was:", text);
  return [];
}

console.log("PARSED RESPONSE:");
console.log(JSON.stringify(parsed, null, 2));

const slots = Array.isArray(parsed?.slots) ? parsed.slots : [];

console.log("EXTRACTED SLOTS:");
console.log(JSON.stringify(slots, null, 2));
console.log("EXTRACTED SLOTS LENGTH:", slots.length);
    
return slots;
    
  } catch (error) {
    console.error("fetchAvailableSlots error:", error);
    return [];
  }
}

async function bookSlot(slotId, flowType, chatId) {
  if (!APP_API_BASE_URL) {
    return { success: false };
  }

  try {
    const res = await fetch(`${APP_API_BASE_URL}/api/apps/69b792dd54c7935ae7606aaa/functions/bookSlot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slot_id: slotId,
        flow_type: flowType,
        patient_name: `telegram_${chatId}`,
        patient_id: chatId.toString(),
        phone: "",
      }),
    });

    if (!res.ok) {
      console.error("Booking failed:", await res.text());
      return { success: false };
    }

    return await res.json();
  } catch (err) {
    console.error("bookSlot error:", err);
    return { success: false };
  }
}

function slotKeyboard(slots, flowType) {
  const rows = slots.slice(0, 8).map((slot) => {
    console.log("SINGLE SLOT OBJECT:");
    console.log(JSON.stringify(slot, null, 2));

    const slotId =
      slot.slot_id ||
      slot.id ||
      slot._id ||
      slot.uuid ||
      slot.value ||
      "missing_id";

    const doctorName =
      slot.doctor_name ||
      slot.doctor ||
      slot.provider_name ||
      slot.provider ||
      "ללא שם";

    const dateText =
      slot.date ||
      slot.day ||
      slot.start_date ||
      "ללא תאריך";

    const timeText =
      slot.time ||
      slot.hour ||
      slot.start_time ||
      "ללא שעה";

    return [
      {
        text: dateText + " | " + timeText + " | " + doctorName,
        callback_data: "slot:" + flowType + ":" + slotId,
      },
    ];
  });

  rows.push([{ text: "חזרה לתפריט הראשי", callback_data: "nav:main" }]);
  return inlineKeyboard(rows);
}
// ---------------------------
// Flow handlers
// ---------------------------

async function showMainMenu(chatId) {
  return sendMessage(chatId, START_TEXT, mainMenuKeyboard());
}

async function handleStart(chatId) {
  return showMainMenu(chatId);
}

async function handleFlowSelection(chatId, messageId, flowCode) {
  if (flowCode === "rehab_exam") {
    return editMessage(
      chatId,
      messageId,
      "האם עברת בדיקה כללית אצל רופא שיניים במהלך השנה האחרונה?",
      yesNoNotSureKeyboard("rehab_exam_q1")
    );
  }

  if (flowCode === "rehab_doctor") {
    return editMessage(
      chatId,
      messageId,
      "האם עברת בדיקה שיקומית במהלך השנה האחרונה?",
      yesNoNotSureKeyboard("rehab_doctor_q1")
    );
  }

  if (flowCode === "rehab_followup") {
    return editMessage(
      chatId,
      messageId,
      "האם אתה נמצא בטיפול שיקומי פעיל במחלקה?",
      yesNoNotSureKeyboard("rehab_followup_q1")
    );
  }

  return editMessage(chatId, messageId, "בחירה לא מזוהה.", backToMainKeyboard());
}

async function handleCallback(chatId, messageId, callbackQueryId, data) {
  await answerCallbackQuery(callbackQueryId);

  // Navigation
  if (data === "nav:main") {
    return editMessage(chatId, messageId, START_TEXT, mainMenuKeyboard());
  }

  // Main menu flow selection
  if (data.startsWith("flow:")) {
    const flowCode = data.split(":")[1];
    return handleFlowSelection(chatId, messageId, flowCode);
  }

  // Journey 1
  if (data === "rehab_exam_q1:yes") {
    return editMessage(
      chatId,
      messageId,
      "האם קיבלת הפניה לבדיקה שיקומית / פרותטית?",
      yesNoNotSureKeyboard("rehab_exam_q2")
    );
  }
  if (data === "rehab_exam_q1:no") {
    return editMessage(
      chatId,
      messageId,
      "לפני קביעת בדיקה שיקומית יש צורך בבדיקה כללית אצל רופא שיניים.\n\nניתן לפנות למרפאה לצורך השלמת הבדיקה.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_exam_q1:unsure") {
    return editMessage(
      chatId,
      messageId,
      "לא הצלחנו להשלים את קביעת התור באופן אוטומטי.\nהפנייה שלך הועברה למזכירות המרפאה להמשך טיפול.",
      backToMainKeyboard()
    );
  }

  if (data === "rehab_exam_q2:yes") {
    return editMessage(
      chatId,
      messageId,
      "האם השלמת את כל הטיפולים המקדימים שנדרשו לך?",
      yesNoNotSureKeyboard("rehab_exam_q3")
    );
  }
  if (data === "rehab_exam_q2:no") {
    return editMessage(
      chatId,
      messageId,
      "יש צורך בהפניה לבדיקה שיקומית על ידי רופא שיניים.\n\nנא לפנות לרופא המטפל.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_exam_q2:unsure") {
    return editMessage(
      chatId,
      messageId,
      "לא הצלחנו להשלים את קביעת התור באופן אוטומטי.\nהפנייה שלך הועברה למזכירות המרפאה להמשך טיפול.",
      backToMainKeyboard()
    );
  }

  if (data === "rehab_exam_q3:yes") {
    const slots = await fetchAvailableSlots("rehab_exam_booking");
console.log("SLOTS RECEIVED IN FLOW:", slots);
console.log("SLOTS LENGTH:", slots?.length);
    
    if (slots.length > 0) {
      return editMessage(
        chatId,
        messageId,
        "להלן תורים זמינים לבדיקה שיקומית:",
        slotKeyboard(slots, "rehab_exam_booking")
      );
    }

    return editMessage(
      chatId,
      messageId,
      "כרגע אין תורים זמינים לבדיקה שיקומית.\nנסה שוב מאוחר יותר או פנה למזכירות.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_exam_q3:no") {
    return editMessage(
      chatId,
      messageId,
      "לפני בדיקה שיקומית יש להשלים את הטיפולים המקדימים.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_exam_q3:unsure") {
    return editMessage(
      chatId,
      messageId,
      "לא הצלחנו להשלים את קביעת התור באופן אוטומטי.\nהפנייה שלך הועברה למזכירות המרפאה להמשך טיפול.",
      backToMainKeyboard()
    );
  }

  // Journey 2
  if (data === "rehab_doctor_q1:yes") {
    return editMessage(
      chatId,
      messageId,
      "האם נאמר לך שניתן להתחיל או להמשיך טיפול שיקומי?",
      yesNoNotSureKeyboard("rehab_doctor_q2")
    );
  }
  if (data === "rehab_doctor_q1:no") {
    return editMessage(
      chatId,
      messageId,
      "כדי לקבוע תור אצל רופא משקם יש צורך בבדיקה שיקומית במהלך השנה האחרונה.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_doctor_q1:unsure") {
    return editMessage(
      chatId,
      messageId,
      "לא הצלחנו להשלים את קביעת התור באופן אוטומטי.\nהפנייה שלך הועברה למזכירות המרפאה להמשך טיפול.",
      backToMainKeyboard()
    );
  }

  if (data === "rehab_doctor_q2:yes") {
    return editMessage(
      chatId,
      messageId,
      "האם אתה יודע או זוכר מי הרופא המשקם המטפל בך?",
      yesDontRememberKeyboard("rehab_doctor_q3")
    );
  }
  if (data === "rehab_doctor_q2:no") {
    return editMessage(
      chatId,
      messageId,
      "בשלב זה עדיין לא ניתן לקבוע תור לרופא משקם.\n\nאם יש צורך בבירור, ניתן לפנות למזכירות.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_doctor_q2:unsure") {
    return editMessage(
      chatId,
      messageId,
      "לא הצלחנו להשלים את קביעת התור באופן אוטומטי.\nהפנייה שלך הועברה למזכירות המרפאה להמשך טיפול.",
      backToMainKeyboard()
    );
  }

  if (data === "rehab_doctor_q3:yes") {
    return editMessage(
      chatId,
      messageId,
      "בשלב הבא נחבר זיהוי רופא והצגת תורים.\nכרגע החיבור הראשוני פעיל.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_doctor_q3:dont_remember") {
    return editMessage(
      chatId,
      messageId,
      "לא הצלחנו להשלים את קביעת התור באופן אוטומטי.\nהפנייה שלך הועברה למזכירות המרפאה להמשך טיפול.",
      backToMainKeyboard()
    );
  }

  // Journey 3
  if (data === "rehab_followup_q1:yes") {
    return editMessage(
      chatId,
      messageId,
      "האם אתה יודע או זוכר מי הרופא המשקם המטפל בך?",
      yesDontRememberKeyboard("rehab_followup_q2")
    );
  }
  if (data === "rehab_followup_q1:no") {
    return editMessage(
      chatId,
      messageId,
      "אם אינך נמצא בטיפול שיקומי פעיל, ייתכן שעליך לבחור במסלול אחר.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_followup_q1:unsure") {
    return editMessage(
      chatId,
      messageId,
      "לא הצלחנו להשלים את קביעת התור באופן אוטומטי.\nהפנייה שלך הועברה למזכירות המרפאה להמשך טיפול.",
      backToMainKeyboard()
    );
  }

  if (data === "rehab_followup_q2:yes") {
    return editMessage(
      chatId,
      messageId,
      "בשלב הבא נחבר זיהוי רופא והצגת תורי המשך.\nכרגע החיבור הראשוני פעיל.",
      backToMainKeyboard()
    );
  }
  if (data === "rehab_followup_q2:dont_remember") {
    return editMessage(
      chatId,
      messageId,
      "לא הצלחנו להשלים את קביעת התור באופן אוטומטי.\nהפנייה שלך הועברה למזכירות המרפאה להמשך טיפול.",
      backToMainKeyboard()
    );
  }

  // Slot placeholder
  if (data.startsWith("slot:")) {
  const [, flowType, slotId] = data.split(":");

  await editMessage(chatId, messageId, "מעבד את הזמנת התור...");

  const result = await bookSlot(slotId, flowType, chatId);

if (result.success) {
  return editMessage(
    chatId,
    messageId,
    `✅ התור נקבע בהצלחה

📅 תאריך: ${result.date || ""}
🕘 שעה: ${result.time || ""}
👨‍⚕️ רופא: ${result.doctor_name || ""}

נשלח אליך אישור בהמשך.`,
    backToMainKeyboard()
  );
}

  return editMessage(
    chatId,
    messageId,
    "התור כבר נתפס או שלא ניתן להזמין כרגע ❌\n\nאנא בחר תור אחר.",
    backToMainKeyboard()
  );
}

  return editMessage(chatId, messageId, "הפעולה לא זוהתה.", backToMainKeyboard());
}

// ---------------------------
// Routes
// ---------------------------

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Telegram webhook server is running" });
});
app.post("/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("Incoming update:", JSON.stringify(update, null, 2));

    // Text messages
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text.startsWith("/start")) {
        const parts = text.split(" ");
        const payload = parts.length > 1 ? parts[1] : null;

        console.log("START payload:", payload);

        if (payload) {
          const token = payload.trim();

          await sendMessage(chatId, "מחפש את מסע המטופל שלך...");

          try {
   const response = await fetch(
  "https://dental-consult-efac37c8.base44.app/api/functions/getPatientJourneyByToken",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api_key": "9f3162fa351041b1bfa5e5921ec3d28c",
    },
    body: JSON.stringify({ token }),
  }
);

const envelope = await response.json();
console.log("Base44 raw result:", JSON.stringify(envelope, null, 2));

const result = envelope?.data || {};
const found = result?.found === true;
const journeyData = result?.data || null;

if (!found && !journeyData) {
  await sendMessage(chatId, "❌ לא נמצא תהליך עבור הקישור שסופק.");
  return res.sendStatus(200);
}

        await sendMessage(chatId, "✅ התהליך אותר בהצלחה.");
console.log("PatientJourney found:", JSON.stringify(journeyData, null, 2));
            return res.sendStatus(200);
          } catch (error) {
            console.error("Base44 error:", error);
            await sendMessage(chatId, "⚠️ אירעה שגיאה בעת בדיקת הקישור.");
            return res.sendStatus(200);
          }
        } else {
          await handleStart(chatId);
          return res.sendStatus(200);
        }
      }
    }

    // Callback buttons
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;
      const data = callback.data;

      await handleCallback(chatId, messageId, callback.id, data);
      return res.sendStatus(200);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    return res.sendStatus(200);
  }
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
