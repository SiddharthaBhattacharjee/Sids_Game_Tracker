# 🎮 SGT (Sid's Game Tracker)

A local-first web app that transforms your personal game list into meaningful insights, visualizations, and AI-powered recommendations.

No need to upload your data. Just your Google Sheet processed locally on your device.

---

## ✨ Features

* 📊 Dashboard analytics (status, platform, genres)
* 🧠 AI-generated player preference insights
* 🎯 Game recommendations based on your history
* 🖼️ Optional RAWG integration for covers & genres
* 💾 Local caching for faster repeated loads
* 🌗 Dark / Light mode with animated backgrounds

---

## 🚀 How it Works

1. You maintain a **Google Sheet** of your games
2. The app reads it directly in your browser
3. Analytics + AI insights are generated locally
4. Nothing is stored on a server

---

## 📋 Required Google Sheet Format

Use the template (recommended):
👉 [https://docs.google.com/spreadsheets/d/15gZfPQ2R0MxUcH5Bv6dQwYNq3-Y0I-WB9sh9-KtB9sw/edit?usp=sharing](https://docs.google.com/spreadsheets/d/15gZfPQ2R0MxUcH5Bv6dQwYNq3-Y0I-WB9sh9-KtB9sw/edit?usp=sharing)

Or match this structure exactly:

| Game           | Platform | Status   | Rating  | Review      |
| -------------- | -------- | -------- | ------ | ----------- |
| Cyberpunk 2077 | PC       | Finished | 9      | Strong narrative immersion and character driven storytelling. smooth combat and strong world building. |

### Rules:

* Column names must match exactly
* Sheet must be **public**
* Rating is a single number between **0–10**
* Status must match allowed values [Finished, Dropped, On Hold, Ongoing]

---

## ⚙️ Setup Instructions

### 1. Clone the repo

git clone [https://github.com/SiddharthaBhattacharjee/Sids_Game_Tracker](https://github.com/SiddharthaBhattacharjee/Sids_Game_Tracker)


---

### 2. Install dependencies

npm install

---

### 3. Run the app

npm run dev

Open:
[http://localhost:5173](http://localhost:5173)

---

### 4. Configure the app (first launch)

You’ll see a setup screen. Fill in:

#### 🔗 Google Sheet URL

* Must be public
* Use the template above

#### 🤖 LLM API (for AI features)

Example (OpenAI-compatible):

API URL:
your-api-url (eg: https://openrouter.ai/api/v1/chat/completions)

API Key:
your-api-key

Model:
your-api-model (eg: gpt-4o-mini)

You can also use OpenRouter or other compatible providers.

---

#### 🎮 RAWG API (optional)

* Enables:

  * Game covers
  * Genre enrichment

Get key: [https://rawg.io/apidocs](https://rawg.io/apidocs)

---

### 5. Test & Save

* Click **Test Configuration**
* Then **Save**

---

## 🧠 AI Behavior

The app:

* extracts your gaming preferences
* generates recommendations
* caches results locally

You can:

* regenerate anytime
* keep previous results for comparison

---

## ⚠️ Common Issues

### ❌ Sheet not loading

* Make sure it’s public
* No empty rows
* Correct column names
* Correct value format

---

### ❌ No recommendations

* Check API key
* Check model name
* Try regenerating

---

### ❌ Missing covers / genres

* RAWG API key may be invalid
* Some games may not match

---

## 🏗️ Tech Stack

* React (Vite)
* LocalStorage (caching)
* OpenAI-compatible APIs
* RAWG API

---

## 📜 License

MIT License

You are free to use, modify, and distribute this project,
but attribution is required.

---

## 👤 Author

Made with ❤️ by **Siddhartha Bhattacharjee**

---

## 🔥 Why this exists

Most trackers store data.

This one:

* understands your taste
* explains your patterns
* suggests what to play next
* a tool to gain insight on your data

---

## ⭐ If you find this useful

Star the repo. Or better -> actually use it.
