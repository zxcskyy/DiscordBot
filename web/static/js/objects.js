class Timer {
    constructor(callback, interval) {
        this.callback = callback;
        this.interval = interval;
        this.timerId = null;
        this.isRunning = false;
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.timerId = setInterval(() => {
                this.callback();
            }, this.interval);
        }
    }

    stop() {
        if (this.isRunning) {
            clearInterval(this.timerId);
            this.timerId = null;
            this.isRunning = false;
        }
    }

    getIsRunning() {
        return this.isRunning;
    }
}

const actions = {
    initPlayer: function (player, data) {
        player.init();
        player.addTrack(data["tracks"]);
        player.updateCurrentQueuePos(data['current_queue_position']);
        player.isDJ = data['is_dj'];
        player.is_paused = data['is_paused'];
        player.current_position = data['current_position'];
        data["users"].forEach(user => {
            player.addUser(user);
        })
    },

    playerUpdate: function (player, data) {
        player.last_update = data["last_update"];
        player.is_connected = data["is_connected"];
        player.current_position = data["last_position"];
    },

    trackUpdate: function (player, data) {
        var track = player.updateCurrentQueuePos(data['current_queue_position']);
        player.is_paused = data['is_paused'];
        if (track?.track_id != data["track_id"]) {
            player.send({ "op": "initPlayer" })
        }
    },

    addTrack: function (player, data) {
        player.addTrack(data["tracks"]);
        var tracks = data["tracks"];
        if (tracks.length == 1) {
            var msg = `Added ${tracks[0]['info']['title']} songs into the queue.`
        } else {
            var msg = `Added ${tracks.length} into the queue.`
        }
        player.showToast(data["requester_id"], msg)
    },

    getTracks: function (player, data) {
        var tracks = data["tracks"];
        if (tracks != undefined) {
            const resultList = $("#search-result-list");
            resultList.empty();
            player.searchList = tracks;
            for (var i in tracks) {
                var track = new Track(tracks[i]);
                resultList.append(`<li class="search-result"><div class="search-result-left"><img src=${track.imageUrl} /><div class="search-result-info"><p class="info">${track.title}</p><p class="desc">${track.author}</p></div></div><p>${player.msToReadableTime(track.length)}</p></li>`)
            }
        }
        $("#search-result-list").fadeIn(200);
        $("#search-loader").fadeOut(200);
    },

    playerClose: function (player, data) {
        player.init();
    },

    updateGuild: function (player, data) {
        const user = data["user"];
        if (user["user_id"] == player.userId) {
            if (data['is_joined']) {
                player.send({ "op": "initPlayer" });
            } else {
                player.init();
            }
        }
        if (data['is_joined']) {
            player.addUser(user);
            player.showToast(user["user_id"], "Joined your channel!");
        } else {
            if (player.users.hasOwnProperty(user["user_id"])) {
                player.showToast(user["user_id"], "Left your channel!");
                delete player.users[user['user_id']];
            }
        }
    },

    updatePause: function (player, data) {
        player.is_paused = data['pause'];
        var msg = "";
        if (data["pause"]) {
            msg = "Paused the player."
        } else {
            msg = "Resumed the player."
        }
        player.showToast(data["requester_id"], msg)
    },

    updatePosition: function (player, data) {
        player.current_position = data["position"];
    },

    swapTrack: function (player, data) {
        var index1 = player.current_queue_position + data['position2']["index"];
        var index2 = player.current_queue_position + data['position1']["index"];
        var track1 = player.queue[index1];
        var track2 = player.queue[index2];

        if (track1?.track_id != data['position1']["track_id"] || track2?.track_id != data['position2']["track_id"]) {
            return player.send({ "op": "initPlayer" });
        }

        player.queue[index1] = player.queue.splice(index2, 1, player.queue[index1])[0];
        player.initSortable();
        player.showToast(data["requester_id"], `${track1.title} and ${track2.title} are swapped`)
    },

    moveTrack: function (player, data) {
        let position = player.current_queue_position + data["position"]["index"];
        let newPosition = player.current_queue_position + data["newPosition"]["index"];
        let element = player.queue.splice(position, 1)[0];
        if (element?.track_id != data["position"]["track_id"]) {
            return player.send({ "op": "initPlayer" });
        }
        player.queue.splice(newPosition, 0, element);

        const $ul = $('#sortable');
        const $li = $ul.children().eq(position);
        $li.detach();
        $ul.children().eq(newPosition).before($li);
        player.showToast(data["requester_id"], `Moved ${element.title} to ${newPosition}`)
    },

    shuffleTrack: function(player, data) {
        var tracks = data["tracks"];
        if (tracks != undefined) {
            player.queue = [];
            tracks.forEach(rawTrack => {

                var track = new Track(rawTrack);
                player.queue.push(track);
            });
            player.initSortable();
            player.showToast(data["requester_id"], "The queue is shuffled.")
        }
    }

}

class Track {
    constructor(object) {
        this.title = object["info"]["title"];
        this.author = object["info"]["author"];
        this.imageUrl = object["thumbnail"];
        this.length = object["info"]["length"];
        this.track_id = object["track_id"];
    }
}

class Player {
    constructor(userId) {
        this.socket = new Socket('http://127.0.0.1:5000');
        this.socket.connect(this);
        this.socket.addMessageListener((msg) => this.handleMessage(msg));
        this.timer = new Timer(() => this.updateTime(), 1000);
        this.userId = parseInt(userId);
        this.isDJ = false;
        this.date = new Date();
        this.queue = [];
        this.users = {};
        this.searchList = []
        this.currentTrack = null;
        this.current_queue_position = 0;
        this.current_position = 0;
        this.is_paused = false;
        this.volume = 100;
        this.last_update = 0;
        this.is_connected = true;
    }

    handleMessage(data) {
        const op = data["op"];
        const validActions = Object.keys(actions);

        if (validActions.includes(op)) {
            actions[op](this, data);
        } else {
            console.log(`Invalid action: ${op}`)
        }

        return this.updateInfo()
    }

    init() {
        this.queue = []
        this.currentTrack = null;
        $('#sortable').empty();
        this.updateInfo();
    }

    initSortable() {
        $('#sortable').empty();
        for (var i in this.queue) {
            var track = this.queue[i];
            $("#sortable").append(`<li><div class="track"><div class="left"><i class="fa-solid fa-bars handle"></i><img src=${track.imageUrl} /><div class="info"><p>${track.title}</p><p class="desc">${track.author}</p></div></div><p>${this.msToReadableTime(track.length)}</p></div></li>`)
        }
    }

    updateCurrentQueuePos(pos) {
        this.current_queue_position = pos - 1;
        this.currentTrack = this.queue[this.current_queue_position];

        $('#sortable li div').removeClass('active');
        const li = $(`#sortable li:eq(${this.current_queue_position})`);
        li.find('div').addClass('active');
        $('.queue-list').animate({ scrollTop: li.position().top - $('.queue-list').position().top }, 'slow');

        return this.currentTrack;
    }

    addUser(user) {
        this.users[user['user_id']] = { "avatar_url": user["avatar_url"], "name": user["name"] };
    }

    addTrack(tracks) {
        for (var i in tracks) {
            var track = new Track(tracks[i]);
            this.queue.push(track);
            $("#sortable").append(`<li><div class="track"><div class="left"><i class="fa-solid fa-bars handle"></i><img src=${track.imageUrl} /><div class="info"><p>${track.title}</p><p class="desc">${track.author}</p></div></div><p>${this.msToReadableTime(track.length)}</p></div></li>`)
        }
    }

    moveTrack(target, to) {
        this.send({ "op": "moveTrack", "position": target, "newPosition": to })
    }

    togglePause() {
        this.send({ "op": "updatePause", "pause": !this.is_paused });
    }

    skipTo(index = 1) {
        this.send({ "op": "skipTo", "index": index });
    }

    backTo(index = 1) {
        this.send({ "op": "backTo", "index": index });
    }

    seekTo(tempPosition) {
        if (this.currentTrack == undefined) {
            return;
        }
        var position = tempPosition / 500 * this.currentTrack.length;
        this.send({ "op": "updatePosition", "position": position });
    }

    shuffle() {
        if ((this.queue.length - this.current_queue_position) > 3) {
            this.send({ "op": "shuffleTrack" });
        } else {
            this.showToast(this.userId, "Add more songs to the queue before shuffling.");
        }
    }

    send(payload) {
        var json = JSON.stringify(payload)
        this.socket.send(json);
    }

    isPlaying() {
        return (this.currentTrack != undefined && this.is_connected);
    }

    msToReadableTime(ms) {
        let totalSeconds = Math.floor(ms / 1000);

        let hours = Math.floor(totalSeconds / 3600);
        let minutes = Math.floor((totalSeconds % 3600) / 60);
        let seconds = totalSeconds % 60;

        minutes = (minutes < 10) ? "0" + minutes : minutes;
        seconds = (seconds < 10) ? "0" + seconds : seconds;

        let timeString = "";
        if (hours > 0) {
            timeString += hours + ":" + minutes + ":" + seconds;
        } else {
            timeString += minutes + ":" + seconds;
        }

        return timeString;
    }

    showToast(userId, msg) {
        var user = this.users[userId];
        if (user != null) {
            var $element = $(`<div class="toast"><img src=${user['avatar_url']} alt="user-icon"/><div class="content"><p class="username">${user['name']}</p><p class="message">${msg}</p></div></div>`)
            $(".toastContrainer").append($element)

            setTimeout(function () {
                $element.fadeOut(500, function () {
                    $(this).remove();
                });
            }, 6000);
        }
    }

    updateTime() {
        if (this.currentTrack == undefined) {
            return this.timer.stop();
        }

        if (this.current_position >= this.currentTrack?.length) {
            return this.timer.stop();
        }
        this.current_position += 1000;
        $("#position").text(this.msToReadableTime(this.current_position));

        var time = (this.current_position / this.currentTrack?.length) * 500;
        $("#seek-bar").val(time);
    }

    updateInfo() {
        var currentTrack = this.currentTrack;
        if (currentTrack == undefined) {
            $("#title").text("");
            $("#author").text("");
            $("#position").text("00:00");
            $("#length").text("00:00");
            $("#image").removeAttr('src');
            $("#largeImage").removeAttr('src');
        } else {
            $("#title").text(currentTrack.title);
            $("#author").text(currentTrack.author);
            $("#length").text(this.msToReadableTime(currentTrack.length));
            $("#image").attr("src", currentTrack.imageUrl);
            $("#largeImage").attr("src", currentTrack.imageUrl);
        }
        var play_pause_btn = $("#play-pause-button")
        if (this.is_paused || currentTrack == undefined) {
            play_pause_btn.removeClass('fa-pause').addClass('fa-play');
            if (this.timer.getIsRunning()) {
                this.timer.stop();
            }
        } else {
            play_pause_btn.removeClass('fa-play').addClass('fa-pause');
            this.timer.start();
        }
    }
}