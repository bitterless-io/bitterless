const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const cliProgress = require('cli-progress');

const QUALITY_FORMATS = [
    {
        label: '4K (2160p)',
        format: 'bestvideo[height<=2160][height>=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160][height>=2160]+bestaudio',
    },
    {
        label: '1080p',
        format: 'bestvideo[height<=1080][height>=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080][height>=1080]+bestaudio',
    },
];

async function getVideoInfo(url) {
    const info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        cookiesFromBrowser: 'chrome',
    });
    return info;
}

async function downloadYouTube(url) {
    const downloadDir = path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }

    console.log(`正在获取视频信息: ${url}`);

    let info;
    try {
        info = await getVideoInfo(url);
    } catch (error) {
        console.error('❌ 获取视频信息失败：', error.message);
        process.exit(1);
    }

    const formats = info.formats || [];
    const maxHeight = Math.max(...formats.filter(f => f.height).map(f => f.height));

    console.log(`视频最高可用分辨率: ${maxHeight}p`);

    if (maxHeight < 1080) {
        console.log('⚠️  没有高清可下载的视频（需要至少 1080p）。');
        process.exit(0);
    }

    // 选择合适的质量档位
    let selectedQuality = null;
    for (const q of QUALITY_FORMATS) {
        const minHeight = q.label.startsWith('4K') ? 2160 : 1080;
        if (maxHeight >= minHeight) {
            selectedQuality = q;
            break;
        }
    }

    if (!selectedQuality) {
        console.log('⚠️  没有高清可下载的视频（需要至少 1080p）。');
        process.exit(0);
    }

    console.log(`开始下载: ${info.title}`);
    console.log(`目标质量: ${selectedQuality.label}`);

    const ytdlpBin = youtubedl.constants.YOUTUBE_DL_PATH;

    const ok = await spawnDownload(ytdlpBin, url, downloadDir, selectedQuality.format);
    if (!ok && selectedQuality.label.startsWith('4K')) {
        console.warn('⚠️  4K 下载失败，尝试回退到 1080p...');
        const fallback = QUALITY_FORMATS[1];
        const ok2 = await spawnDownload(ytdlpBin, url, downloadDir, fallback.format);
        if (!ok2) process.exit(1);
    } else if (!ok) {
        process.exit(1);
    }
}

function buildYtdlpArgs(url, downloadDir, format) {
    return [
        url,
        '--output', path.join(downloadDir, '%(title)s.%(ext)s'),
        '--format', format,
        '--merge-output-format', 'mp4',
        '--no-warnings',
        '--newline',
        '--cookies-from-browser', 'chrome',
    ];
}

let progressBar = null;

function createProgressBar() {
    progressBar = new cliProgress.SingleBar({
        format: '  📥 [{bar}] {percentage}%  {size}  {speed}  ETA {eta_formatted}',
        barCompleteChar: '#',
        barIncompleteChar: '-',
        hideCursor: true,
        clearOnComplete: false,
        barsize: 20,
    });
    progressBar.start(100, 0, { size: '', speed: '' });
}

function updateProgress(percent, size, speed, eta) {
    if (!progressBar) createProgressBar();
    progressBar.update(parseFloat(percent), { size, speed, eta_formatted: eta || '' });
}

function stopProgressBar() {
    if (progressBar) {
        progressBar.stop();
        progressBar = null;
    }
}

function printNormal(msg) {
    stopProgressBar();
    console.log(msg);
}

function spawnDownload(bin, url, downloadDir, format) {
    return new Promise((resolve) => {
        const args = buildYtdlpArgs(url, downloadDir, format);
        const child = spawn(bin, args);

        function processStream(stream) {
            let buf = '';
            stream.on('data', (chunk) => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop();
                for (const line of lines) {
                    handleLine(line.trim());
                }
            });
            stream.on('end', () => {
                if (buf.trim()) handleLine(buf.trim());
            });
        }

        processStream(child.stdout);
        processStream(child.stderr);

        child.on('close', (code) => {
            stopProgressBar();
            if (code === 0) {
                console.log('✅ 下载完成！');
                resolve(true);
            } else {
                console.error(`❌ 下载失败（退出码 ${code}）`);
                resolve(false);
            }
        });
    });
}

function handleLine(line) {
    if (!line) return;

    // Progress line: [download]  42.3% of ~  123.45MiB at   5.00MiB/s ETA 00:20
    const progressMatch = line.match(
        /\[download\]\s+(\d+\.\d+)%\s+of\s+~?\s*([\d.]+\s*\S+).*?at\s+([\d.]+\s*\S+\/s)(?:\s+ETA\s+(\S+))?/
    );
    if (progressMatch) {
        const [, percent, totalSize, speed, eta] = progressMatch;
        updateProgress(percent, totalSize.trim(), speed.trim(), eta);
        return;
    }

    // Merger / post-processing lines
    if (/\[Merger\]|\[ffmpeg\]|\[ExtractAudio\]|Deleting original file/.test(line)) {
        printNormal(`  🔧 ${line}`);
        return;
    }

    // Destination line
    if (/\[download\] Destination:/.test(line)) {
        printNormal(`  📁 ${line}`);
        return;
    }

    // Already downloaded
    if (/\[download\].*has already been downloaded/.test(line)) {
        printNormal(`  ✔️  ${line}`);
        return;
    }

    // Print other informational lines that are not suppressed
    if (!/^\s*$/.test(line) && !/WARNING|\[debug\]/.test(line)) {
        printNormal(`  ${line}`);
    }
}

if (require.main === module) {
    const url = process.argv[2];
    if (!url) {
        console.log('请提供 YouTube 链接！');
        console.log('用法: node ytdl.js "https://www.youtube.com/watch?v=xxxx"');
        process.exit(1);
    }
    downloadYouTube(url);
}

module.exports = downloadYouTube;
