const TOKEN =
  PropertiesService.getScriptProperties().getProperty("SLACK_ACCESS_TOKEN");

const BASE_API_PATH = "https://slack.com/api";

/**
 * key: https://ja.wikipedia.org/wiki/ISO_3166-1
 * value: https://cloud.google.com/translate/docs/languages
 */
const Lang = {
  /** 🇯🇵日本 */
  jp: "ja",
  /** 🇺🇸アメリカ合衆国 */
  us: "en",
  /** 🇲🇲ミャンマー連邦共和国 */
  mm: "my",
  /** 🇻🇳ベトナム */
  vn: "vi",
};

const headers = {
  Authorization: `Bearer ${TOKEN}`,
};

const doPost = (e) => {
  try {
    const json = JSON.parse(e.postData.getDataAsString());
    if (json.type == "url_verification") {
      return ContentService.createTextOutput(json.challenge);
    }

    if (json.type == "event_callback" && json.event.type == "reaction_added") {
      return ContentService.createTextOutput(onReactionAdded(json.event));
    }
  } catch (ex) {
    console.error("Error occur", ex);
  }
};

/**
 * @param {object} payload
 * @returns {string}
 */
const query = (payload) =>
  Object.entries(payload)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

/**
 * @param {object} payload
 * @param {string} payload.channel チャンネルID
 * @param {string} payload.blocks 本文
 * @param {string} payload.thread_ts タイムスタンプ
 * @returns {void}
 */
const postThreadMessage = (payload) => {
  const options = {
    method: "post",
    contentType: "application/json",
    headers,
    payload: JSON.stringify({ ...payload, token: TOKEN }),
  };

  const response = UrlFetchApp.fetch(
    `${BASE_API_PATH}/chat.postMessage`,
    options
  );
  console.log("postThreadMessage", JSON.parse(response.getContentText()));
};

/**
 * @param {object} payload
 * @param {string} payload.channel チャンネルID
 * @param {string} payload.ts タイムスタンプ
 * @returns {object[]}
 */
const getMessages = (payload) => {
  const options = { headers };

  const response = UrlFetchApp.fetch(
    `${BASE_API_PATH}/conversations.replies?${query(payload)}`,
    options
  );

  const json = JSON.parse(response.getContentText());
  console.log("getMessages", JSON.parse(response.getContentText()));

  return json.messages;
};

/**
 * @param {object} payload
 * @param {string} payload.channel チャンネルID
 * @param {string} payload.message_ts タイムスタンプ
 * @returns {string}
 */
const getPermalink = (payload) => {
  const options = { headers };

  const response = UrlFetchApp.fetch(
    `${BASE_API_PATH}/chat.getPermalink?${query(payload)}`,
    options
  );

  const json = JSON.parse(response.getContentText());
  console.log("getPermalink", JSON.parse(response.getContentText()));

  return json.permalink;
};

/**
 * @param {string[]} messages
 * @param {string} county
 * @returns {boolean}
 */
const isTranslated = (messages, county) => {
  return messages.some(
    (message) => new RegExp(county).test(message.text)
  );
};

/**
 * @param {string} text
 * @returns {string}
 */
const excludeMentionTag = (text) => {
  return text.replace(/<.+>/g, "");
};

const onReactionAdded = (json) => {
  if (json.item.type !== "message") {
    console.error("Type is not `message`");
    return "Type is not `message`";
  }

  const keys = Object.keys(Lang).join("|");
  const [match] =
    json.reaction.match(new RegExp(`(?<=^flag-)(${keys})\$|^${keys}\$`, "g")) ??
    [];

  if (!match) {
    console.error("Invalid Translate Language");
    return "Invalid Translate Language";
  }

  const { channel, ts } = json.item;
  console.log("item", json.item);

  try {
    const messages = getMessages({ channel, ts });
    const [message] = messages;

    if (!messages || !message) {
      console.error("Not found message");
      return "Not found message";
    }

    const country = `:flag-${match}:`;

    if (isTranslated(messages, country)) {
      console.error("Already Translated");
      return "Already Translated";
    }

    const originalText = excludeMentionTag(message.text);
    const translatedText = `${country} ${LanguageApp.translate(
      originalText,
      "",
      Lang[match]
    )}`;

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `> <${getPermalink({
            channel,
            message_ts: ts,
          })}|${originalText
            .replace(/\n/, "")
            .slice(0, 30)}>\n\n${translatedText}`,
        },
      },
    ];
    console.log("blocks", blocks);

    try {
      postThreadMessage({
        channel,
        blocks,
        thread_ts: message.thread_ts || ts,
      });
    } catch (error) {
      console.error("Error message Send", error);
      return "Error message Send";
    }
  } catch (error) {
    console.error("Error create message", error);
    return "Error create message";
  }

  return "OK";
};
