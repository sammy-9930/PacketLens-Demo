"use strict";

const element = (id) => document.getElementById(id);
const play = element("play");
const slider = element("position");
const speed = element("speed");
const chart = element("chart");
const context = chart.getContext("2d");
const number = new Intl.NumberFormat();
const protocolNames = new Map([
    ["1", "ICMP"], ["2", "IGMP"], ["6", "TCP"], ["17", "UDP"],
    ["50", "ESP"], ["58", "ICMPv6"], ["59", "No Next"], ["132", "SCTP"]
]);
let bins = replayBins;
let series, packetCounts, cumulativePackets, timeline, peakIndex;
const protocols = [["TCP", "#77efc6"], ["UDP", "#84b9ff"], ["ICMP", "#ffd17b"], ["ICMPv6", "#d6a9ff"]];
const applications = [["HTTP", "#77efc6"], ["DNS", "#84b9ff"], ["NTP", "#ffd17b"]];
let cursor = 0;
let selectedBurst = null;
let timer = null;

function createBars(list, categories) {
    return categories.map(([name, color]) => {
        const item = document.createElement("li");
        item.innerHTML = '<span></span><div class="track" aria-hidden="true"><div class="fill"></div></div><span class="count"></span>';
        item.firstElementChild.textContent = name;
        const fill = item.querySelector(".fill");
        fill.style.setProperty("--color", color);
        element(list).append(item);
        return { name, fill, count: item.lastElementChild };
    });
}

let protocolBars;
const applicationBars = createBars("applications", applications);

function updateBars(bars, counts, packets) {
    for (const bar of bars) {
        const count = counts?.[bar.name] ?? 0;
        const share = packets ? 100 * count / packets : 0;
        bar.count.textContent = number.format(count);
        bar.fill.style.width = share + "%";
    }
}

function draw() {
    if (!context) return;
    const width = chart.clientWidth;
    const height = chart.clientHeight;
    if (width < 80 || height < 80) return;
    const scale = window.devicePixelRatio || 1;
    chart.width = Math.round(width * scale);
    chart.height = Math.round(height * scale);
    context.scale(scale, scale);

    const left = 46;
    const bottom = height - 28;
    const top = 14;
    const right = width - 12;
    const peak = series[peakIndex];
    const ceiling = Math.max(0.25, Math.ceil(peak * 1.1 * 4) / 4);
    const duration = timeline[timeline.length - 1];
    const x = (seconds) => left + (right - left) * seconds / duration;
    const y = (rate) => bottom - (bottom - top) * rate / ceiling;

    context.font = "12px system-ui";
    context.fillStyle = "#aabcc9";
    context.strokeStyle = "#304353";
    context.textAlign = "right";
    for (let index = 0; index <= 4; index++) {
        const value = ceiling * index / 4;
        const row = y(value);
        context.beginPath();
        context.moveTo(left, row);
        context.lineTo(right, row);
        context.stroke();
        context.fillText(value.toFixed(2), left - 7, row + 4);
    }
    context.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
        const seconds = duration * i / 4;
        context.fillText(formatTime(seconds), x(seconds), height - 7);
    }

    const plot = (end, color, weight) => {
        context.beginPath();
        context.moveTo(left, y(series[0]));
        for (let tick = 1; tick <= end; tick++) {
            context.lineTo(x(timeline[tick]), y(series[tick - 1]));
            if (tick < end) context.lineTo(x(timeline[tick]), y(series[tick]));
        }
        context.lineWidth = weight;
        context.strokeStyle = color;
        context.stroke();
    };
    plot(bins.length, "#67869a", 1.25);
    if (cursor > 0) {
        plot(cursor, "#77efc6", 2.5);
        const selectedX = x(timeline[cursor]);
        context.beginPath();
        context.moveTo(selectedX, top);
        context.lineTo(selectedX, bottom);
        context.lineWidth = 1;
        context.strokeStyle = "#77efc6";
        context.stroke();
    }
}

const timeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const preciseTime = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

function formatTime(seconds) {
    const formatter = seconds > 0 && seconds < 0.01 ? preciseTime : timeFormat;
    return formatter.format(seconds) + " s";
}

function describeProtocol(bin, packets) {
    if (!bin) return "Select an interval to see its protocol breakdown.";
    if (!packets) return "No decoded packets in this interval.";
    const counts = Object.entries(bin.protocols);
    const largest = counts.reduce((peak, [, count]) => Math.max(peak, count), 0);
    const names = counts.filter(([, count]) => count === largest).map(([name]) => name).join(", ");
    return `${names} ${names.includes(", ") ? "each had" : "had"} ${number.format(largest)} of `
        + `${number.format(packets)} packets (${Math.round(100 * largest / packets)}%).`;
}

function render() {
    const bin = bins[cursor - 1];
    const packets = packetCounts[cursor - 1] ?? 0;
    element("rate").innerHTML = (series[cursor - 1] ?? 0).toFixed(2) + " <small>Mb/s</small>";
    element("pps").innerHTML = number.format(Math.round(packets / (bin?.seconds ?? 1))) + " <small>packets/s</small>";
    element("total").textContent = number.format(cumulativePackets[cursor]);
    element("interval").textContent = bin
        ? `${formatTime(timeline[cursor - 1])} to ${formatTime(timeline[cursor])}`
        : "Select a point on the timeline or press Play.";
    element("top-protocol").textContent = describeProtocol(bin, packets);
    element("time").textContent = formatTime(timeline[cursor]) + " / " + formatTime(timeline[bins.length]);
    slider.value = cursor;
    slider.setAttribute("aria-valuetext", formatTime(timeline[cursor]));
    updateBars(protocolBars, bin?.protocols, packets);
    updateBars(applicationBars, bin?.applications, packets);
    const finding = selectedBurst && selectedBurst.index === cursor - 1
        ? selectedBurst : null;
    let message = "";
    if (finding) {
        const range = `${formatTime(timeline[cursor - 1])} to ${formatTime(timeline[cursor])}`;
        message = finding.protocol
            ? `From ${range}, ${finding.protocol} accounted for `
                + `${number.format(bin.protocols[finding.protocol])} of ${number.format(packets)} packets.`
            : `Baseline from ${range}. Compare it with the bursts.`;
    }
    if (element("finding").textContent !== message) {
        element("finding").textContent = message;
    }
    draw();
}

function stop(status) {
    window.clearTimeout(timer);
    timer = null;
    play.textContent = cursor === bins.length ? "Replay" : "Play";
    element("state").textContent = status;
}

function schedule() {
    const delay = 1000 * (bins[cursor].seconds ?? 1) / Number(speed.value);
    timer = window.setTimeout(() => {
        cursor++;
        render();
        if (cursor === bins.length) stop("Complete");
        else schedule();
    }, Math.min(2147483647, Math.max(16, delay)));
}

function start() {
    if (cursor === bins.length) cursor = 0;
    render();
    play.textContent = "Pause";
    element("state").textContent = "Playing";
    schedule();
}

function setTrace(nextBins, recording = null) {
    const imported = recording !== null;
    bins = nextBins;
    series = bins.map((bin) => bin.bytes * 8 / (bin.seconds ?? 1) / 1e6);
    packetCounts = bins.map((bin) => Object.values(bin.protocols).reduce((a, b) => a + b, 0));
    peakIndex = series.reduce((peak, rate, index) => rate > series[peak] ? index : peak, 0);
    cumulativePackets = [0];
    for (const count of packetCounts) {
        cumulativePackets.push(cumulativePackets[cumulativePackets.length - 1] + count);
    }
    timeline = [0];
    for (const bin of bins) timeline.push(timeline[timeline.length - 1] + (bin.seconds ?? 1));
    const extraProtocols = new Set(bins.flatMap((bin) => Object.keys(bin.protocols)));
    for (const [name] of protocols) extraProtocols.delete(name);
    element("protocols").replaceChildren();
    protocolBars = createBars("protocols", [
        ...protocols, ...Array.from(extraProtocols, (name) => [name, "#aabcc9"])
    ]);
    element("application-panel").hidden = imported;
    element("guided-replay").hidden = imported;
    selectedBurst = null;
    element("sample").hidden = !imported;
    element("recording-name").textContent = recording ?? "Bundled synthetic trace";
    slider.max = bins.length;
    cursor = 0;
    stop("Ready");
    render();
}

function parseMetrics(text) {
    const lines = text.trim().split(/\r?\n/);
    return lines.map((line) => {
        const { seconds, bytes, protocols: counts, decoded } = JSON.parse(line);
        if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(bytes) ||
            bytes < 0 || !Number.isFinite(bytes * 8 / seconds) ||
            !counts || typeof counts !== "object" || Array.isArray(counts)) {
            throw new Error("invalid metrics interval");
        }
        const mapped = {};
        let packets = 0;
        for (const [id, count] of Object.entries(counts)) {
            if (!/^\d{1,3}$/.test(id) || Number(id) > 255 ||
                !Number.isSafeInteger(count) || count < 0) {
                throw new Error("invalid protocol count");
            }
            const name = protocolNames.get(id) ?? ("IP " + id);
            mapped[name] = count;
            packets += count;
        }
        if (packets !== decoded || !Number.isSafeInteger(packets)) {
            throw new Error("protocol counts do not match decoded packets");
        }
        return { seconds, bytes, protocols: mapped };
    });
}

function jumpToBurst(protocol) {
    const index = bins.reduce((peak, bin, index) =>
        bin.protocols[protocol] > bins[peak].protocols[protocol] ? index : peak, 0);
    selectedBurst = { index, protocol };
    seek(index + 1);
}

function seek(position) {
    cursor = position;
    stop(cursor === bins.length ? "Complete" : "Paused");
    render();
}

element("baseline").addEventListener("click", () => {
    selectedBurst = { index: 0 };
    seek(1);
});
element("peak").addEventListener("click", () => {
    selectedBurst = null;
    seek(peakIndex + 1);
});
element("tcp-burst").addEventListener("click", () => jumpToBurst("TCP"));
element("udp-burst").addEventListener("click", () => jumpToBurst("UDP"));

play.addEventListener("click", () => {
    if (timer === null) start();
    else stop("Paused");
});
element("reset").addEventListener("click", () => {
    selectedBurst = null;
    cursor = 0;
    stop("Ready");
    render();
});
speed.addEventListener("change", () => {
    if (timer !== null) {
        window.clearTimeout(timer);
        start();
    }
});
slider.addEventListener("input", () => {
    seek(Number(slider.value));
});
const fileInput = element("metrics-file");
fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
        const imported = parseMetrics(await file.text());
        if (fileInput.files[0] !== file) return;
        setTrace(imported, file.name);
        element("trace-message").textContent = "Loaded " + file.name;
    } catch {
        element("trace-message").textContent = "Could not open this capture metrics file.";
    }
});
element("sample").addEventListener("click", () => {
    fileInput.value = "";
    setTrace(replayBins);
    element("trace-message").textContent = "";
});
window.addEventListener("resize", draw);
setTrace(replayBins);
