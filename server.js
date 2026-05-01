import express from "express";
import fetch from "node-fetch";
 
const app = express();
app.use(express.json());
 
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
console.log("SERVER VERSION: integration-v7-cache-merge-full");
 
if (!BOT_TOKEN) {
  throw new Error("Missing BOT_TOKEN environment variable");
}
 
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
 
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
 
const journeyTokensByChat = new Map();
 
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
 
// ===== Journey Token Helper =====
function getJourneyTokenFromSession(chatId) {
  return journeyTokensByChat.get(String(chatId)) || null;
}

// ===== New Integration Functions =====
async function fetchBotJourneyInfo(token) {
  const response = await fetch(
    "https://preview--dental-consult-efac37c8.base44.app/api/functions/getBotJourneyInfo",
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
  return envelope?.data ?? envelope ?? {};
}

async function fetchAvailableSlotsFromSystem2(botTreatmentKey) {
  const requestBody = { bot_treatment_key: botTreatmentKey };
  console.log("REQUEST TO SYSTEM 2 - botTreatmentKey:", botTreatmentKey);
  console.log("REQUEST TO SYSTEM 2 - body:", JSON.stringify(requestBody));

  const response = await fetch(
    "https://rehab-dent-admin.base44.app/api/functions/getAvailableSlotsForSpecialty",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": "dental-consult-service-2026"
      },
      body: JSON.stringify(requestBody),
    }
  );

  console.log("SYSTEM 2 HTTP status:", response.status);
  const envelope = await response.json();
  console.log("SYSTEM 2 RAW RESPONSE:", JSON.stringify(envelope, null, 2));
  return envelope?.slots ?? [];
}

// ===== NEW: Book slot in System 2 with patient info =====
async function bookSlotInSystem2(slotId, patientInfo) {
  const requestBody = {
    slot_id: slotId,
    patient_name: patientInfo?.full_name || "",
    patient_id: patientInfo?.id_number || "",
    phone: patientInfo?.phone || "",
    booking_source: "telegram",
    action: "confirm"
  };
  
  console.log("BOOK SLOT IN SYSTEM 2 - body:", JSON.stringify(requestBody));

  const response = await fetch(
    "https://rehab-dent-admin.base44.app/api/functions/bookSlot",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": "dental-consult-service-2026"
      },
      body: JSON.stringify(requestBody),
    }
  );

  console.log("BOOK SLOT HTTP status:", response.status);
  const envelope = await response.json();
  console.log("BOOK SLOT RAW RESPONSE:", JSON.stringify(envelope, null, 2));
  return envelope;
}

// ===== NEW: Cancel Booking by slot_id =====
async function cancelBookingInSystem2(slotId) {
  const requestBody = { slot_id: slotId };
  console.log("CANCEL BOOKING IN SYSTEM 2 - body:", JSON.stringify(requestBody));

  const response = await fetch(
    "https://rehab-dent-admin.base44.app/api/functions/cancelBooking",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": "dental-consult-service-2026"
      },
      body: JSON.stringify(requestBody),
    }
  );

  console.log("CANCEL BOOKING HTTP status:", response.status);
  const envelope = await response.json();
  console.log("CANCEL BOOKING RAW RESPONSE:", JSON.stringify(envelope, null, 2));
  return envelope;
}

async function fetchJourneyAvailableSlots(token) {
  const response = await fetch(
    "https://dental-consult-efac37c8.base44.app/api/functions/getJourneyAvailableSlots",
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
  return envelope?.data ?? envelope ?? {};
}
 
async function createJourneyBookingRecord(token, slotId) {
  const response = await fetch(
    "https://dental-consult-efac37c8.base44.app/api/functions/createJourneyBooking",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_key": "9f3162fa351041b1bfa5e5921ec3d28c",
      },
      body: JSON.stringify({
        token,
        slot_id: slotId,
        external_slot_id: slotId, // UPDATED
        booking_source: "telegram",
      }),
    }
  );
  const envelope = await response.json();
  return envelope?.data ?? envelope ?? {};
}
 
async function sendJourneyBookingMenu(chatId, messageId, token) {
  const bookingState = await fetchJourneyBookingState(token);
  console.log("SEND MENU NEW BUILD");
  console.log("DEBUG bookingState:", JSON.stringify(bookingState, null, 2));
 
  let localBooking = journeyTokensByChat.get(String(chatId) + "_booking");
  console.log("DEBUG localBooking:", JSON.stringify(localBooking, null, 2));
 
  const hasSystemABooking = bookingState?.success && bookingState?.exists && bookingState?.booking;

  if (hasSystemABooking || localBooking) {
    const sysA = bookingState?.booking || {};
    const b = {
      slot_date: sysA.slot_date || localBooking?.slot_date || "-",
      slot_time: sysA.slot_time || localBooking?.slot_time || "-",
      provider_name: sysA.provider_name || localBooking?.provider_name || "-",
      location_name: sysA.location_name || localBooking?.location_name || "-",
    };
 
    return editMessage(
      chatId,
      messageId,
      `🏥 יש לך תור קיים\n\n📅 ${b.slot_date}\n🕒 ${b.slot_time}\n👨‍⚕️ ${b.provider_name}\n📍 ${b.location_name}`,
      {
        inline_keyboard: [
          [{ text: "📋 צפה בהזמנה", callback_data: "booking:view" }],
          [{ text: "❌ בטל תור", callback_data: "booking:cancel" }],
          [{ text: "🔁 שנה מועד", callback_data: "booking:reschedule" }]
        ]
      }
    );
  }
 
  // התור לא קיים. מדלגים על בדיקת השדה current_step בגלל שהוא חסר ב-API.
  return editMessage(
    chatId,
    messageId,
    "📅 ניתן לקבוע תור עבור שלב זה.\n\nבחר:",
    {
      inline_keyboard: [
        [{ text: "📅 הצג תורים זמינים", callback_data: "booking:show_slots" }],
        [{ text: "🏠 חזרה לתפריט", callback_data: "nav:main" }]
      ]
    }
  );
}
 
async function fetchPatientJourneyByToken(token) {
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
  const result = envelope?.data ?? envelope ?? {};
  return result;
}
 
async function fetchJourneyBookingState(token) {
  const response = await fetch(
    "https://dental-consult-efac37c8.base44.app/api/functions/getJourneyBookingState",
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
  const result = envelope?.data ?? envelope ?? {};
  return result;
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
    [{ text: "קביעת בדיקה שיקומית", callback_data: "flow:journey_booking" }],
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
    const url = `${APP_API_BASE_URL}/api/functions/getAvailableSlots`;
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
        callback_data: "" + flowType + ":" + slotId,
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
  if (flowCode === "journey_booking") {
    const token = getJourneyTokenFromSession(chatId);
    if (!token) {
      return editMessage(
        chatId,
        messageId,
        "❌ לא נמצא טוקן פעיל למסע המטופל.",
        backToMainKeyboard()
      );
    }
    return sendJourneyBookingMenu(chatId, messageId, token);
  }
 
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
    const token = getJourneyTokenFromSession(chatId);
 
    if (!token) {
      return editMessage(
        chatId,
        messageId,
        "❌ לא נמצא טוקן פעיל למסע המטופל.",
        {
          inline_keyboard: [
            [{ text: "🏠 חזרה", callback_data: "nav:main" }]
          ]
        }
      );
    }
 
    return sendJourneyBookingMenu(chatId, messageId, token);
  }
 
  // Main menu flow selection
  if (data.startsWith("flow:")) {
    const flowCode = data.split(":")[1];
    return handleFlowSelection(chatId, messageId, flowCode);
  }
 
  // Slots — קריאה לשתי המערכות בנפרד
  if (data === "booking:show_slots") {
    await editMessage(chatId, messageId, "🔍 טוען מידע על התור שלך...");

    const token = getJourneyTokenFromSession(chatId);
    if (!token) {
      return editMessage(chatId, messageId, "❌ לא נמצא טוקן פעיל.", {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }

    // צעד 1: קרא מידע על המסע מאפליקציה 1
    const journeyInfo = await fetchBotJourneyInfo(token);
    console.log("JOURNEY INFO:", JSON.stringify(journeyInfo, null, 2));

    if (!journeyInfo?.success || !journeyInfo?.bot_specialty_key) {
      return editMessage(chatId, messageId, "❌ לא ניתן למצוא מידע על המסע.", {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }

    // צעד 2: קרא תורים ישירות מאפליקציה 2
    const slots = await fetchAvailableSlotsFromSystem2(journeyInfo.bot_treatment_key);
    console.log("SLOTS FROM SYSTEM 2:", JSON.stringify(slots, null, 2));

    // שמור את פרטי המטופל לשימוש במהלך קביעת התור
    journeyTokensByChat.set(String(chatId) + "_patient_info", JSON.stringify(journeyInfo.patient));

    if (!slots || slots.length === 0) {
      return editMessage(chatId, messageId, "😔 כרגע אין תורים זמינים.\nנסה שוב מאוחר יותר.", {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }

    const slotRows = slots.slice(0, 8).map((slot) => [{
      text: `${slot.date || ""} ${slot.start_time || ""} | ${slot.doctor_name || ""}`,
      callback_data: `slot:${slot.id}`,
    }]);
    slotRows.push([{ text: "🔙 חזרה", callback_data: "nav:main" }]);

    return editMessage(chatId, messageId, "📅 בחר תור:", {
      inline_keyboard: slotRows
    });
  }

  // --- Cancel Booking ---
  if (data === "booking:cancel") {
    await editMessage(chatId, messageId, "⏳ מבטל את התור...");
    
    const token = getJourneyTokenFromSession(chatId);
    if (!token) {
      return editMessage(chatId, messageId, "❌ לא נמצא טוקן פעיל.", {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }

    const bookingState = await fetchJourneyBookingState(token);
    const localBooking = journeyTokensByChat.get(String(chatId) + "_booking");
    const sysA = bookingState?.booking || {};
    
    const slotIdToCancel = sysA.external_slot_id || localBooking?.external_slot_id || localBooking?.slot_id;
    
    if (!slotIdToCancel) {
      return editMessage(chatId, messageId, "❌ לא נמצא מזהה משבצת תקין לביטול.", {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }

    const cancelResult = await cancelBookingInSystem2(slotIdToCancel);

    if (cancelResult?.success) {
      journeyTokensByChat.delete(String(chatId) + "_booking");
      
      return editMessage(chatId, messageId, "✅ התור בוטל בהצלחה והמועד חזר להיות זמין במערכת.", {
        inline_keyboard: [[{ text: "🏠 חזרה לתפריט הראשי", callback_data: "nav:main" }]]
      });
    } else {
      const errorMsg = cancelResult?.error || "שגיאה לא ידועה מול מערכת הניהול.";
      return editMessage(chatId, messageId, `❌ אירעה שגיאה בביטול התור.\nסיבה: ${errorMsg}`, {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }
  }

  // --- View Booking Details ---
  if (data === "booking:view") {
    const token = getJourneyTokenFromSession(chatId);
    if (!token) return answerCallbackQuery(callbackQueryId, "❌ לא נמצא טוקן");
    return sendJourneyBookingMenu(chatId, messageId, token);
  }
 
  // קביעת תור — שתי קריאות:
  // 1. bookSlot ב-System 2 (יצירת Booking + סימון slot כתפוס + שמירת פרטי מטופל)
  // 2. createJourneyBooking ב-System A (עדכון מסע המטופל)
  if (data.startsWith("slot:")) {
    const slotId = data.slice(5);
    const token = getJourneyTokenFromSession(chatId);
    const patientInfoStr = journeyTokensByChat.get(String(chatId) + "_patient_info");

    await editMessage(chatId, messageId, "⏳ שומר את התור שבחרת...");

    if (!token) {
      return editMessage(chatId, messageId, "❌ לא נמצא טוקן פעיל.", {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }

    const patientInfo = patientInfoStr ? JSON.parse(patientInfoStr) : {};
    console.log("BOOKING FOR PATIENT:", patientInfo.full_name, "| ID:", patientInfo.id_number, "| Phone:", patientInfo.phone);

    // קריאה 1: bookSlot ב-System 2 (יצירת Booking + עדכון slot כתפוס)
    const system2Result = await bookSlotInSystem2(slotId, patientInfo);
    console.log("SYSTEM 2 BOOK RESULT:", JSON.stringify(system2Result, null, 2));

    if (!system2Result?.success) {
      const errorMsg = system2Result?.error || "שגיאה לא ידועה";
      return editMessage(chatId, messageId, `❌ לא ניתן לקבוע את התור כרגע.\nשגיאה: ${errorMsg}`, {
        inline_keyboard: [
          [{ text: "🔄 הצג תורים", callback_data: "booking:show_slots" }],
          [{ text: "🔙 חזרה", callback_data: "nav:main" }]
        ]
      });
    }

    // קריאה 2: createJourneyBooking ב-System A (עדכון מסע המטופל)
    const result = await createJourneyBookingRecord(token, slotId);
    console.log("CREATE BOOKING RESULT:", JSON.stringify(result, null, 2));

    if (result?.success) {
      const b = result.booking || {};
      
      journeyTokensByChat.set(String(chatId) + "_booking", {
        slot_date: system2Result.date || b.slot_date || "",
        slot_time: system2Result.time || b.slot_time || "",
        provider_name: system2Result.doctor_name || b.provider_name || "",
        location_name: b.location_name || "",
        slot_id: slotId,
        external_slot_id: slotId
      });
      
      return editMessage(
        chatId,
        messageId,
        `✅ התור נקבע בהצלחה!\n\n📅 ${system2Result.date || b.slot_date || ""}\n🕒 ${system2Result.time || b.slot_time || ""}\n👨‍⚕️ ${system2Result.doctor_name || b.provider_name || ""}\n\nשם: ${patientInfo.full_name || ""}\nטלפון: ${patientInfo.phone || ""}`,
        {
          inline_keyboard: [
            [{ text: "📋 צפה בתור", callback_data: "booking:view" }],
            [{ text: "🏠 חזרה לתפריט", callback_data: "nav:main" }]
          ]
        }
      );
    }

    return editMessage(chatId, messageId, "❌ לא ניתן לקבוע את התור כרגע. נסה שוב.", {
      inline_keyboard: [
        [{ text: "🔄 הצג תורים", callback_data: "booking:show_slots" }],
        [{ text: "🔙 חזרה", callback_data: "nav:main" }]
      ]
    });
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
 
    // Button clicks (callback_query)
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;
      const data = callback.data;
 
      console.log("Button clicked:", data);
 
      await handleCallback(chatId, messageId, callback.id, data);
      return res.sendStatus(200);
    }
 
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
          journeyTokensByChat.set(String(chatId), token);
 
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
 
            console.log("Base44 HTTP status:", response.status, response.statusText);
 
            const envelope = await response.json();
            console.log("Base44 raw result:", JSON.stringify(envelope, null, 2));
 
            const result = envelope?.data ?? envelope ?? {};
            const journeyData =
              result?.data ??
              (result?.public_token ? result : null);
 
            const found =
              result?.found === true ||
              !!journeyData;
 
            if (!found) {
              await sendMessage(chatId, "❌ לא נמצא תהליך עבור הקישור שסופק.");
              return res.sendStatus(200);
            }
 
            await sendMessage(
              chatId,
              "👋 נמצא עבורך תהליך שיקום הפה!\nמה תרצה לעשות?",
              {
                inline_keyboard: [
                  [{ text: "📅 קביעת/ניהול תור", callback_data: "flow:journey_booking" }],
                  [{ text: "📄 צפייה בפרטים", callback_data: "VIEW_DETAILS" }],
                  [{ text: "☎️ יצירת קשר", callback_data: "CONTACT" }]
                ]
              }
            );
 
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
 
    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    return res.sendStatus(200);
  }
});
 
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
