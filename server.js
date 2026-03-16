import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Telegram webhook server is running" });
});

app.post("/telegram/webhook", async (req, res) => {
  try {

    const update = req.body;

    console.log("Incoming update:", JSON.stringify(update, null, 2));

    const chatId =
      update.message?.chat?.id ||
      update.callback_query?.message?.chat?.id;

    if (chatId) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: "הבוט מחובר בהצלחה"
        })
      });
    }

    res.sendStatus(200);

  } catch (error) {
    console.error(error);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
