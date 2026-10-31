(function (exports) {
  "use strict";

  // The loader wraps this file as: vendetta => { return <this expression> }
  // so the `vendetta` object is available as a free variable here.
  var storage = vendetta.plugin.storage;
  var common = vendetta.metro.common;
  var React = common.React;
  var RN = common.ReactNative;
  var FluxDispatcher = common.FluxDispatcher;
  var clipboard = common.clipboard;
  var findByStoreName = vendetta.metro.findByStoreName;
  var semanticColors = vendetta.ui.semanticColors;
  var getAssetIDByName = vendetta.ui.assets.getAssetIDByName;
  var Forms = vendetta.ui.components.Forms;
  var showToast = vendetta.ui.toasts.showToast;

  var FormSection = Forms.FormSection;
  var FormRow = Forms.FormRow;
  var FormInput = Forms.FormInput;
  var FormDivider = Forms.FormDivider;
  var FormSwitchRow = Forms.FormSwitchRow;
  var FormText = Forms.FormText;
  var ScrollView = RN.ScrollView;
  var View = RN.View;
  var Text = RN.Text;
  var TouchableOpacity = RN.TouchableOpacity;
  var h = React.createElement;

  var ChannelStore = findByStoreName("ChannelStore");
  var UserStore = findByStoreName("UserStore");

  // Safe icon lookup: returns undefined instead of throwing if a name is missing.
  function icon(name) {
    try { return getAssetIDByName(name); } catch (e) { return undefined; }
  }

  // Defaults
  storage.targetUserId = storage.targetUserId || "";
  storage.fromUserId = storage.fromUserId || "";
  storage.messageContent = storage.messageContent || "";
  storage.embedEnabled = !!storage.embedEnabled;
  storage.embedTitle = storage.embedTitle || "";
  storage.embedDescription = storage.embedDescription || "";
  storage.embedImageUrl = storage.embedImageUrl || "";
  if (!Array.isArray(storage.fakes)) storage.fakes = [];

  // Snowflake-style ID so Discord's message sorting/timestamp code does not choke.
  function makeSnowflake() {
    try {
      var ms = BigInt(Date.now()) - BigInt(1420070400000);
      var rand = BigInt(Math.floor(Math.random() * 4194303));
      return ((ms << BigInt(22)) | rand).toString();
    } catch (e) {
      return String(Date.now() - 1420070400000) + String(Math.floor(Math.random() * 9000000 + 1000000));
    }
  }

  function toRawUser(user, id) {
    if (!user) {
      return { id: id, username: "Unknown User", discriminator: "0", avatar: null, bot: false };
    }
    return {
      id: user.id,
      username: user.username,
      global_name: user.globalName,
      discriminator: user.discriminator || "0",
      avatar: user.avatar,
      bot: !!user.bot,
    };
  }

  function createMessage(channelId, authorId, content, embed) {
    return {
      id: makeSnowflake(),
      channel_id: channelId,
      author: toRawUser(UserStore.getUser(authorId), authorId),
      content: content,
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: embed ? [embed] : [],
      reactions: [],
      pinned: false,
      type: 0,
      flags: 0,
      referenced_message: null,
    };
  }

  function displayName(user, id) {
    if (!user) return "Unknown (" + id + ")";
    return user.globalName || user.username || id;
  }

  // Dispatches a local-only MESSAGE_CREATE and remembers it in the manage list.
  // Nothing is sent to Discord's servers.
  function inject(channelId, authorId, content, embed) {
    try {
      var message = createMessage(channelId, authorId, content, embed || null);
      FluxDispatcher.dispatch({
        type: "MESSAGE_CREATE",
        channelId: channelId,
        message: message,
        optimistic: false,
        isPushNotification: false,
      });
      var list = (storage.fakes || []).slice();
      list.unshift({
        id: message.id,
        channelId: channelId,
        authorId: authorId,
        authorName: displayName(UserStore.getUser(authorId), authorId),
        message: message,
      });
      storage.fakes = list.slice(0, 100);
      return true;
    } catch (e) {
      console.error("[Message Faker] inject failed:", e);
      return false;
    }
  }

  function findFake(id) {
    var list = storage.fakes || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Removes it from the screen and from the list.
  function removeFake(id) {
    var rec = findFake(id);
    if (rec) {
      try {
        FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", id: id, channelId: rec.channelId });
      } catch (e) {
        console.error("[Message Faker] delete failed:", e);
      }
    }
    storage.fakes = (storage.fakes || []).filter(function (r) { return r.id !== id; });
  }

  function editFake(id, content) {
    var rec = findFake(id);
    if (!rec) return false;
    try {
      var updated = Object.assign({}, rec.message, {
        content: content,
        edited_timestamp: new Date().toISOString(),
      });
      FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: updated });
      storage.fakes = (storage.fakes || []).map(function (r) {
        return r.id === id ? Object.assign({}, r, { message: updated }) : r;
      });
      return true;
    } catch (e) {
      console.error("[Message Faker] edit failed:", e);
      return false;
    }
  }

  // After an app restart the message is gone from the screen but still in the list.
  function reshowFake(id) {
    var rec = findFake(id);
    if (!rec) return false;
    try {
      FluxDispatcher.dispatch({
        type: "MESSAGE_CREATE",
        channelId: rec.channelId,
        message: rec.message,
        optimistic: false,
        isPushNotification: false,
      });
      return true;
    } catch (e) {
      console.error("[Message Faker] reshow failed:", e);
      return false;
    }
  }

  function clearFakes() {
    (storage.fakes || []).slice().forEach(function (r) { removeFake(r.id); });
    storage.fakes = [];
  }

  function getDMChannel(userId) {
    try {
      if (typeof ChannelStore.getDMFromUserId === "function") {
        var id = ChannelStore.getDMFromUserId(userId);
        if (id) return id;
      }
    } catch (e) {
      console.error("[Message Faker] getDMChannel failed:", e);
    }
    return null;
  }

  function useStored(key) {
    var state = React.useState(storage[key]);
    var value = state[0];
    var setValue = state[1];
    return [value, function (v) { storage[key] = v; setValue(v); }];
  }

  function button(label, color, onPress, extra) {
    return h(
      TouchableOpacity,
      {
        style: Object.assign({
          backgroundColor: color,
          padding: 15,
          borderRadius: 8,
          marginTop: 10,
          marginHorizontal: 15,
          alignItems: "center",
          justifyContent: "center",
        }, extra || {}),
        onPress: onPress,
      },
      h(Text, { style: { color: "white", fontSize: 16, fontWeight: "600" } }, label)
    );
  }

  function field(title, hint, value, setValue, placeholder) {
    return h(
      FormSection,
      { title: title },
      h(FormText, { style: { color: semanticColors.TEXT_MUTED, marginBottom: 10, marginHorizontal: 15 } }, hint),
      h(FormInput, { value: value, onChange: setValue, placeholder: placeholder, title: title })
    );
  }

  function CreateView() {
    var target = useStored("targetUserId");
    var from = useStored("fromUserId");
    var content = useStored("messageContent");
    var embedOn = useStored("embedEnabled");
    var eTitle = useStored("embedTitle");
    var eDesc = useStored("embedDescription");
    var eImg = useStored("embedImageUrl");

    function paste(setter, label) {
      return function () {
        Promise.resolve(clipboard.getString()).then(function (text) {
          if (text) {
            setter(String(text).trim());
            showToast("Pasted " + label, icon("toast_copy_link"));
          }
        }).catch(function () {
          showToast("Failed to read clipboard", icon("Small"));
        });
      };
    }

    function send() {
      if (!target[0] || !from[0] || !content[0]) {
        showToast("Fill in target, sender and message", icon("ic_close_16px"));
        return;
      }
      var channelId = getDMChannel(target[0]);
      if (!channelId) {
        showToast("No DM found. Open a DM with that user first.", icon("ic_close_16px"));
        return;
      }
      var embed = null;
      if (embedOn[0] && (eTitle[0] || eDesc[0] || eImg[0])) {
        embed = {
          type: "rich",
          title: eTitle[0] || undefined,
          description: eDesc[0] || undefined,
          image: eImg[0] ? { url: eImg[0] } : undefined,
          color: 0x5865f2,
        };
      }
      var ok = inject(channelId, from[0], content[0], embed);
      showToast(ok ? "Fake message added (local only)" : "Failed to add message", icon(ok ? "toast_image_saved" : "ic_close_16px"));
    }

    function fillTest() {
      var me = UserStore.getCurrentUser();
      if (!me) { showToast("Could not get current user", icon("ic_close_16px")); return; }
      target[1](me.id);
      from[1](me.id);
      content[1]("This is a test message!");
    }

    var children = [
      h(FormSection, { key: "intro", title: "MESSAGE FAKER" },
        h(FormRow, { label: "Adds a message to your own screen only. Nothing is sent to Discord or to anyone else." })),
      h(FormDivider, { key: "d1" }),
      field("TARGET USER ID (whose DM)", "Open a DM with this user first", target[0], target[1], "Target user ID"),
      button("Paste target ID", "#5865F2", paste(target[1], "target ID")),
      h(FormDivider, { key: "d2" }),
      field("FROM USER ID (shown as sender)", "Who the message appears to be from", from[0], from[1], "Sender user ID"),
      button("Paste sender ID", "#5865F2", paste(from[1], "sender ID")),
      h(FormDivider, { key: "d3" }),
      field("MESSAGE CONTENT", "The message text", content[0], content[1], "Message content"),
      h(FormDivider, { key: "d4" }),
      h(FormSwitchRow, { key: "embedSwitch", label: "Add an embed", value: embedOn[0], onValueChange: embedOn[1] }),
    ];

    if (embedOn[0]) {
      children.push(
        field("EMBED TITLE", "Optional", eTitle[0], eTitle[1], "Embed title"),
        field("EMBED DESCRIPTION", "Optional", eDesc[0], eDesc[1], "Embed description"),
        field("EMBED IMAGE URL", "Optional. Your app will load this URL.", eImg[0], eImg[1], "https://...")
      );
    }

    children.push(
      button("Add fake message", "#3BA55D", send, { marginBottom: 10 }),
      button("Fill test values", "#F26522", fillTest),
      h(View, { key: "spacer", style: { height: 50 } })
    );

    return h(
      ScrollView,
      { style: { flex: 1, backgroundColor: semanticColors.BACKGROUND_MOBILE_PRIMARY } },
      children.map(function (c, i) {
        return c.key != null ? c : React.cloneElement(c, { key: "k" + i });
      })
    );
  }

  function smallButton(label, color, onPress) {
    return h(
      TouchableOpacity,
      {
        onPress: onPress,
        style: {
          backgroundColor: color,
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 6,
          marginRight: 8,
          marginTop: 8,
        },
      },
      h(Text, { style: { color: "white", fontWeight: "600" } }, label)
    );
  }

  function ManageView() {
    var tick = React.useState(0);
    var refresh = function () { tick[1](tick[0] + 1); };
    var editingState = React.useState(null);
    var draftState = React.useState("");
    var editing = editingState[0];
    var list = storage.fakes || [];

    function row(rec) {
      var msg = rec.message || {};
      var isEditing = editing === rec.id;
      var when = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "";
      var body = [
        h(Text, { key: "who", style: { color: semanticColors.TEXT_NORMAL, fontWeight: "700" } },
          rec.authorName + (msg.edited_timestamp ? " (edited)" : "")),
        h(Text, { key: "meta", style: { color: semanticColors.TEXT_MUTED, fontSize: 12, marginBottom: 6 } },
          when + "  \u2022  channel " + rec.channelId),
      ];

      if (isEditing) {
        body.push(
          h(FormInput, { key: "edit", value: draftState[0], onChange: draftState[1], placeholder: "New message text", title: "Edit message" }),
          h(View, { key: "editBtns", style: { flexDirection: "row" } },
            smallButton("Save", "#3BA55D", function () {
              if (!draftState[0]) { showToast("Message can't be empty", icon("ic_close_16px")); return; }
              var ok = editFake(rec.id, draftState[0]);
              showToast(ok ? "Edited (local only)" : "Edit failed", icon(ok ? "toast_image_saved" : "ic_close_16px"));
              editingState[1](null);
              refresh();
            }),
            smallButton("Cancel", "#747F8D", function () { editingState[1](null); })
          )
        );
      } else {
        body.push(
          h(Text, { key: "text", style: { color: semanticColors.TEXT_NORMAL } }, msg.content || "(no text)"),
          h(View, { key: "btns", style: { flexDirection: "row", flexWrap: "wrap" } },
            smallButton("Edit", "#5865F2", function () { draftState[1](msg.content || ""); editingState[1](rec.id); }),
            smallButton("Delete", "#ED4245", function () {
              removeFake(rec.id);
              showToast("Removed from screen and list", icon("toast_image_saved"));
              refresh();
            }),
            smallButton("Re-show", "#747F8D", function () {
              var ok = reshowFake(rec.id);
              showToast(ok ? "Shown again" : "Could not show", icon(ok ? "toast_image_saved" : "ic_close_16px"));
            })
          )
        );
      }

      return h(View, { key: rec.id, style: { padding: 15 } }, body);
    }

    var children = [
      h(FormSection, { key: "hdr", title: "FAKED MESSAGES (" + list.length + ")" },
        h(FormText, { style: { color: semanticColors.TEXT_MUTED, marginHorizontal: 15 } },
          "Local only. After an app restart the messages disappear from chat but stay here. Tap Re-show to bring one back.")),
    ];

    if (list.length === 0) {
      children.push(h(FormRow, { key: "empty", label: "No faked messages yet." }));
    } else {
      list.forEach(function (rec, i) {
        children.push(row(rec));
        children.push(h(FormDivider, { key: "div" + i }));
      });
      children.push(button("Delete all", "#ED4245", function () {
        clearFakes();
        showToast("Cleared all", icon("toast_image_saved"));
        refresh();
      }));
    }
    children.push(h(View, { key: "spacer", style: { height: 50 } }));

    return h(ScrollView, { style: { flex: 1, backgroundColor: semanticColors.BACKGROUND_MOBILE_PRIMARY } }, children);
  }

  function Settings() {
    var tabState = React.useState("create");
    var tab = tabState[0];
    var count = (storage.fakes || []).length;
    function tabBtn(id, label) {
      var active = tab === id;
      return h(
        TouchableOpacity,
        {
          key: id,
          onPress: function () { tabState[1](id); },
          style: {
            flex: 1,
            padding: 12,
            alignItems: "center",
            backgroundColor: active ? "#5865F2" : "transparent",
            borderRadius: 8,
            margin: 4,
          },
        },
        h(Text, { style: { color: active ? "white" : semanticColors.TEXT_NORMAL, fontWeight: "600" } }, label)
      );
    }
    return h(
      View,
      { style: { flex: 1, backgroundColor: semanticColors.BACKGROUND_MOBILE_PRIMARY } },
      h(View, { style: { flexDirection: "row", padding: 8 } },
        tabBtn("create", "Create"),
        tabBtn("manage", "Manage (" + count + ")")),
      tab === "create" ? h(CreateView) : h(ManageView)
    );
  }

  exports.default = {
    onLoad: function () {
      window.messageFaker = { inject: inject, createMessage: createMessage, getDMChannel: getDMChannel, remove: removeFake, edit: editFake, clear: clearFakes };
    },
    onUnload: function () {
      delete window.messageFaker;
    },
    settings: Settings,
  };

  return exports;
})({});
