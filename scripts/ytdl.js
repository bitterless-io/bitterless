const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const cliProgress = require('cli-progress');
const chalk = require('chalk');
const { Command } = require('commander');

const QUALITY_FORMATS = [
    {
        label: '4K (2160p)',
        minHeight: 2160,
        format: 'bestvideo[height<=2160][height>=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160][height>=2160]+bestaudio',
    },
    {
        label: '1080p',
        minHeight: 1080,
        format: 'bestvideo[height<=1080][height>=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080][height>=1080]+bestaudio',
    },
];

async function getVideoInfo(url, browser) {
    const info = await youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        cookiesFromBrowser: browser,
    });
    return info;
}

async function downloadYouTube(url, options) {
    const { browser, output } = options;
    const downloadDir = output || path.join(os.homedir(), 'Downloads');

    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }

    console.log(chalk.cyan('🔍 正在获取视频信息...') + ' ' + chalk.gray(url));

    let info;
    try {
        info = await getVideoInfo(url, browser);
    } catch (error) {
        console.error(chalk.red('❌ 获取视频信息失败：') + ' ' + error.message);
        process.exit(1);
    }

    const formats = info.formats || [];
    const maxHeight = Math.max(...formats.filter(f => f.height).map(f => f.height));

    console.log(chalk.bold('📺 标题：') + ' ' + chalk.white(info.title));
    console.log(chalk.bold('📐 最高分辨率：') + ' ' + chalk.yellow(`${maxHeight}p`));

    if (maxHeight < 1080) {
        console.log(chalk.yellow('⚠️  没有高清可下载的视频（需要至少 1080p）。'));
        process.exit(0);
    }

    let selectedQuality = null;
    for (const q of QUALITY_FORMATS) {
        if (maxHeight >= q.minHeight) {
            selectedQuality = q;
            break;
        }
    }

    if (!selectedQuality) {
        console.log(chalk.yellow('⚠️  没有高清可下载的视频（需要至少 1080p）。'));
        process.exit(0);
    }

    console.log(chalk.bold('🎯 目标质量：') + ' ' + chalk.green(selectedQuality.label));
    console.log(chalk.bold('📂 保存目录：') + ' ' + chalk.gray(downloadDir));

    const ytdlpBin = youtubedl.constants.YOUTUBE_DL_PATH;

    const ok = await spawnDownload(ytdlpBin, url, downloadDir, selectedQuality.format, browser);
    if (!ok && selectedQuality.label.startsWith('4K')) {
        console.warn(chalk.yellow('⚠️  4K 下载失败，尝试回退到 1080p...'));
        const fallback = QUALITY_FORMATS[1];
        const ok2 = await spawnDownload(ytdlpBin, url, downloadDir, fallback.format, browser);
        if (!ok2) process.exit(1);
    } else if (!ok) {
        process.exit(1);
    }
}

function buildYtdlpArgs(url, downloadDir, format, browser) {
    return [
        url,
        '--output', path.join(downloadDir, '%(title)s.%(ext)s'),
        '--format', format,
        '--merge-output-format', 'mp4',
        '--no-warnings',
        '--newline',
        '--cookies-from-browser', browser,
    ];
}

let progressBar = null;

function createProgressBar() {
    progressBar = new cliProgress.SingleBar({
        format: '  📥 ' + chalk.cyan('[{bar}]') + ' ' + chalk.yellow('{percentage}%') + '  {size}  ' + chalk.green('{speed}') + '  ETA {eta_formatted}',
        barCompleteChar: '#',
        barIncompleteChar: '-',
        hideCursor: true,
        clearOnComplete: false,
        barsize: 25,
    });
    progressBar.start(100, 0, { size: '', speed: '', eta_formatted: '' });
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

function spawnDownload(bin, url, downloadDir, format, browser) {
    return new Promise((resolve) => {
        const args = buildYtdlpArgs(url, downloadDir, format, browser);
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
                console.log(chalk.green('✅ 下载完成！'));
                resolve(true);
            } else {
                console.error(chalk.red(`❌ 下载失败（退出码 ${code}）`));
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
        printNormal(chalk.magenta('  🔧 ') + chalk.gray(line));
        return;
    }

    // Destination line
    if (/\[download\] Destination:/.test(line)) {
        printNormal(chalk.blue('  📁 ') + chalk.gray(line));
        return;
    }

    // Already downloaded
    if (/\[download\].*has already been downloaded/.test(line)) {
        printNormal(chalk.green('  ✔️  ') + line);
        return;
    }

    // Print other informational lines that are not suppressed
    if (!/^\s*$/.test(line) && !/WARNING|\[debug\]|\[download\]/.test(line)) {
        printNormal(chalk.gray('  ' + line));
    }
}

if (require.main === module) {
    const program = new Command();

    program
        .name('ytdl')
        .description('下载 YouTube 高清视频（1080p / 4K）')
        .version('1.0.0')
        .argument('<url>', 'YouTube 视频链接')
        .option('-b, --browser <browser>', '从指定浏览器读取 Cookie', 'chrome')
        .option('-o, --output <dir>', '保存目录', path.join(os.homedir(), 'Downloads'))
        .action((url, opts) => {
            downloadYouTube(url, opts);
        });

    program.parse();
}

module.exports = downloadYouTube;
