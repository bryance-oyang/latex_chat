//"use strict";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

var websocket = null;
var registered = false;
var connected = false;

function submit_username() {
  let username = $("#username_input").val();
  let decoded_message = {"type":"register_username", "username":username};
  let message = JSON.stringify(decoded_message);

  if (!connected) {
    $("#enter_username_modal_error").html("<br><span style='color:red'>Connection Error</span>");
  } else {
    websocket.send(message);
    registered = true;
    $("#status").html("Connection Status: <span style='color:green'>Connected</span>");
    $("#enter_username_modal").modal("hide");
    $("#msg_area").focus();
  }
}

function recv_mesg(event) {
  let decoded_message = JSON.parse(event.data);
  let type = decoded_message["type"] || "";
  if (type == "update_username_list") {
    let username_list = decoded_message["username_list"] || "";
    $("#username_list").empty();
    for (let i = 0; i < username_list.length; i++) {
      let li = $("<li>");
      li.css({"font-weight":"bold", "color":"#eeeeee"});
      li.text(username_list[i]);
      $("#username_list").append(li);
    }
  } else if (type == "msg") {
    let timestamp = decoded_message["timestamp"] || "";
    let username = decoded_message["username"] || "";
    let msg = decoded_message["msg"] || "";

    let msg_html = $("<p>");

    // timestamp
    let timestamp_text = $("<span>");
    timestamp_text.addClass("text-muted");
    timestamp_text.text("[" + timestamp + "] ");

    // username
    let username_text = $("<span>");
    username_text.css({"font-weight":"bold"});
    username_text.text(username + ": ");

    // msg
    let msg_txt = $("<span>");
    msg_txt.text(msg);

    msg_html.append(timestamp_text);
    msg_html.append(username_text);
    msg_html.append(msg_txt);

    // post msg and scroll to bottom
    $("#prev_msg").append(msg_html);
    MathJax.typesetPromise([msg_txt[0]]);
    $("#prev_msg").scrollTop($("#prev_msg")[0].scrollHeight);
  }
}

function send_msg() {
  if (!connected || !registered) {
    return;
  }

  let msg = $("#msg_area").val();
  let decoded_message = {"type":"msg", "msg":msg}
  let message = JSON.stringify(decoded_message);
  websocket.send(message);
  $("#msg_area").val("");
  $("#msg_area").focus();
}

function get_username() {
  $("#status").html("Connection Status: <span style='color:orange'>Connecting...</span>");
  $("#enter_username_modal").modal({backdrop: "static", keyboard: false});
  $("#enter_username_modal").modal("show");
}

function open_websocket() {
  // don't open new connection if already open (websocket.onclose callback sets websocket to null)
  if (websocket != null) {
    return
  }
  registered = false;
  connected = false;

  websocket = new WebSocket("ws://localhost:9999/");
  websocket.onopen = function(event) {
    connected = true;
    $("#enter_username_modal_error").html("");
    get_username();
  }
  websocket.onerror = function(event) {
    registered = false;
    connected = false;
    $("#status").html("Connection Status: <span style='color:red'>Error</span>");
    websocket.close();
  }
  websocket.onclose = function(event) {
    // try to prevent the onclose logic from running more than once for each opened websocket
    if (websocket == null) {
      return;
    }

    registered = false;
    connected = false;
    $("#status").html("Connection Status: <span style='color:red'>Not Connected</span>");
    setTimeout(open_websocket, 3000);
    websocket = null;
  }
  websocket.onmessage = recv_mesg;
}


function chat_main() {
  registered = false;
  connected = false;
  $("#status").html("Connection Status: <span style='color:red'>Not Connected</span>");

  $("#enter_username_modal").on("shown.bs.modal", function () {
    $("#username_input").focus();
  });

  $("#username_input").on("keyup", function(event) {
    if (event.keyCode == 13) {
      submit_username();
    }
  });
  $("#msg_area").on("keyup", function(event) {
    if (event.keyCode == 13) {
      send_msg();
    }
  });

  open_websocket();
}
