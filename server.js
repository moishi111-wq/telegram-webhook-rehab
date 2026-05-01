import express from "express";
import fetch from "node-fetch";
 
const app = express();
app.use(express.json());
 
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
console.log("SERVER VERSION: integration-v8-system2-source-of-truth");
 
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

  const envelope = await response.json();
  return envelope?.slots ?? [];
}

// ===== NEW: Fetch Active Booking from System 2 =====
async function fetchActiveBookingFromSystem2(patientId) {
  if (!patientId) return { success: false };
  const requestBody = { patient_id: patientId };
  console.log("CHECKING SYSTEM 2 FOR PATIENT ID:", patientId);

  const response = await fetch(
    "https://rehab-dent-admin.base44.app/api/functions/getActiveBookingForPatient",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": "dental-consult-service-2026"
      },
      body: JSON.stringify(requestBody),
    }
  );

  const envelope = await response.json();
  console.log("SYSTEM 2 ACTIVE BOOKING RESULT:", JSON.stringify(envelope));
  return envelope;
}

async function bookSlotInSystem2(slotId, patientInfo) {
  const requestBody = {
    slot_id: slotId,
    patient_name: patientInfo?.full_name || "",
    patient_id: patientInfo?.id_number || "",
    phone: patientInfo?.phone || "",
    booking_source: "telegram",
    action: "confirm"
  };
  
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

  const envelope = await response.json();
  return envelope;
}

async function cancelBookingInSystem2(slotId) {
  const requestBody = { slot_id: slotId };
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

  const envelope = await response.json();
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
        external_slot_id: slotId,
        booking_source: "telegram",
      }),
    }
  );
  const envelope = await response.json();
  return envelope?.data ?? envelope ?? {};
}
 
async function sendJourneyBookingMenu(chatId, messageId, token) {
  // נמשוך את פרטי המטופל כדי לשאול את System 2
  const journeyInfo = await fetchBotJourneyInfo(token);
  const patientId = journeyInfo?.patient?.id_number;

  let activeBooking = null;

  if (patientId) {
    const sys2Result = await fetchActiveBookingFromSystem2(patientId);
    if (sys2Result?.success && sys2Result?.booking) {
      activeBooking = sys2Result.booking;
    }
  }

  // גיבוי לזיכרון מקומי במידה והפונקציה עדיין לא עלתה לאוויר
  if (!activeBooking) {
    activeBooking = journeyTokensByChat.get(String(chatId) + "_booking");
  }

  if (activeBooking) {
    return editMessage(
      chatId,
      messageId,
      `🏥 יש לך תור קיים\n\n📅 ${activeBooking.date || activeBooking.slot_date || "-"}\n🕒 ${activeBooking.time || activeBooking.slot_time || "-"}\n👨‍⚕️ ${activeBooking.doctor_name || activeBooking.provider_name || "-"}\n📍 מרפאת שיקום הפה`,
      {
        inline_keyboard: [
          [{ text: "📋 צפה בהזמנה", callback_data: "booking:view" }],
          [{ text: "❌ בטל תור", callback_data: "booking:cancel" }],
          [{ text: "🔁 שנה מועד", callback_data: "booking:reschedule" }]
        ]
      }
    );
  }
 
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
 
async function fetchAvailableSlots(flowType) {
  if (!APP_API_BASE_URL) {
    return [];
  }
 
  try {
    const url = `${APP_API_BASE_URL}/api/functions/getAvailableSlots`;
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
 
    if (!res.ok) {
      return [];
    }
 
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return [];
    }
 
    const slots = Array.isArray(parsed?.slots) ? parsed.slots : [];
    return slots;
 
  } catch (error) {
    return [];
  }
}
 
function slotKeyboard(slots, flowType) {
  const rows = slots.slice(0, 8).map((slot) => {
    const slotId =
      slot.slot_id || slot.id || slot._id || slot.uuid || slot.value || "missing_id";
 
    const doctorName =
      slot.doctor_name || slot.doctor || slot.provider_name || slot.provider || "ללא שם";
 
    const dateText =
      slot.date || slot.day || slot.start_date || "ללא תאריך";
 
    const timeText =
      slot.time || slot.hour || slot.start_time || "ללא שעה";
 
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
 
  // Slots
  if (data === "booking:show_slots") {
    await editMessage(chatId, messageId, "🔍 מחפש תורים זמינים...");

    const token = getJourneyTokenFromSession(chatId);
    if (!token) {
      return editMessage(chatId, messageId, "❌ לא נמצא טוקן פעיל.", {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }

    const journeyInfo = await fetchBotJourneyInfo(token);

    if (!journeyInfo?.success || !journeyInfo?.bot_specialty_key) {
      return editMessage(chatId, messageId, "❌ לא ניתן למצוא מידע על המסע.", {
        inline_keyboard: [[{ text: "🔙 חזרה", callback_data: "nav:main" }]]
      });
    }

    const slots = await fetchAvailableSlotsFromSystem2(journeyInfo.bot_treatment_key);
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

    const journeyInfo = await fetchBotJourneyInfo(token);
    const patientId = journeyInfo?.patient?.id_number;

    let slotIdToCancel = null;

    if (patientId) {
      const sys2Result = await fetchActiveBookingFromSystem2(patientId);
      if (sys2Result?.success && sys2Result?.booking) {
        slotIdToCancel = sys2Result.booking.slot_id;
      }
    }

    if (!slotIdToCancel) {
      const localBooking = journeyTokensByChat.get(String(chatId) + "_booking");
      slotIdToCancel = localBooking?.slot_id;
    }
    
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
 
  // קביעת תור
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

    // קריאה 1: bookSlot ב-System 2
    const system2Result = await bookSlotInSystem2(slotId, patientInfo);

    if (!system2Result?.success) {
      const errorMsg = system2Result?.error || "שגיאה לא ידועה";
      return editMessage(chatId, messageId, `❌ לא ניתן לקבוע את התור כרגע.\nשגיאה: ${errorMsg}`, {
        inline_keyboard: [
          [{ text: "🔄 הצג תורים", callback_data: "booking:show_slots" }],
          [{ text: "🔙 חזרה", callback_data: "nav:main" }]
        ]
      });
    }

    // קריאה 2: createJourneyBooking ב-System A
    const result = await createJourneyBookingRecord(token, slotId);

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
 
    // Button clicks (callback_query)
    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;
      const data = callback.data;
 
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
 
            const envelope = await response.json();
 
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
