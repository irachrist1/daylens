using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Automation;

namespace Daylens.WindowsCaptureHelper;

internal static class Program
{
    private const int SchemaVersion = 1;
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(500);
    private static readonly HashSet<string> FirefoxFamily = new(StringComparer.OrdinalIgnoreCase)
    {
        "firefox", "zen", "waterfox", "librewolf", "palemoon", "floorp",
    };

    private static int Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, args) =>
        {
            args.Cancel = true;
            cts.Cancel();
        };

        var lastForegroundKey = string.Empty;
        var lastTabKey = string.Empty;

        while (!cts.Token.IsCancellationRequested)
        {
            try
            {
                PollForeground(ref lastForegroundKey, ref lastTabKey);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[windows-capture-helper] poll error: {ex.Message}");
            }

            Thread.Sleep(PollInterval);
        }

        return 0;
    }

    private static void PollForeground(ref string lastForegroundKey, ref string lastTabKey)
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return;

        _ = GetWindowThreadProcessId(hwnd, out var pid);
        using var process = SafeGetProcess(pid);
        if (process is null) return;

        var exePath = process.MainModule?.FileName ?? process.ProcessName;
        var appName = process.ProcessName;
        var bundleId = System.IO.Path.GetFileName(exePath).ToLowerInvariant();
        var windowTitle = ReadWindowTitle(hwnd);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var mono = Stopwatch.GetTimestamp();

        var foregroundKey = $"{pid}:{hwnd}:{windowTitle}";
        if (!string.Equals(foregroundKey, lastForegroundKey, StringComparison.Ordinal))
        {
            lastForegroundKey = foregroundKey;
            lastTabKey = string.Empty;
            Emit(new HelperEvent
            {
                TsMs = now,
                MonoNs = mono,
                EventType = "window_changed",
                AppBundleId = bundleId,
                AppName = appName,
                Pid = pid,
                WindowTitle = windowTitle,
                Source = "uia_foreground",
                Confidence = "observed",
                Platform = "win32",
                SchemaVer = SchemaVersion,
            });
        }

        if (!LooksLikeBrowser(bundleId, appName, exePath))
        {
            return;
        }

        if (IsFirefoxFamily(bundleId, appName, exePath))
        {
            var tabKey = $"firefox-unknown:{pid}";
            if (string.Equals(tabKey, lastTabKey, StringComparison.Ordinal)) return;
            lastTabKey = tabKey;
            Emit(new HelperEvent
            {
                TsMs = now,
                MonoNs = mono,
                EventType = "tab_sampled",
                AppBundleId = bundleId,
                AppName = appName,
                Pid = pid,
                WindowTitle = windowTitle,
                Source = "uia_tab",
                Confidence = "unknown",
                Platform = "win32",
                SchemaVer = SchemaVersion,
            });
            return;
        }

        if (!TryReadChromiumTab(hwnd, out var url, out var pageTitle))
        {
            return;
        }

        var normalizedTabKey = $"{pid}:{url}";
        if (string.Equals(normalizedTabKey, lastTabKey, StringComparison.Ordinal)) return;
        lastTabKey = normalizedTabKey;

        Emit(new HelperEvent
        {
            TsMs = now,
            MonoNs = mono,
            EventType = "tab_sampled",
            AppBundleId = bundleId,
            AppName = appName,
            Pid = pid,
            WindowTitle = windowTitle,
            Url = url,
            PageTitle = pageTitle,
            Source = "uia_tab",
            Confidence = "observed",
            Platform = "win32",
            SchemaVer = SchemaVersion,
        });
    }

    private static Process? SafeGetProcess(int pid)
    {
        try
        {
            return Process.GetProcessById(pid);
        }
        catch
        {
            return null;
        }
    }

    private static string? ReadWindowTitle(IntPtr hwnd)
    {
        const int maxLen = 2048;
        var builder = new StringBuilder(maxLen);
        var length = GetWindowText(hwnd, builder, maxLen);
        if (length <= 0) return null;
        var title = builder.ToString().Trim();
        return string.IsNullOrWhiteSpace(title) ? null : title;
    }

    private static bool LooksLikeBrowser(string bundleId, string appName, string exePath)
    {
        var haystack = $"{bundleId} {appName} {exePath}".ToLowerInvariant();
        return haystack.Contains("chrome")
            || haystack.Contains("msedge")
            || haystack.Contains("edge")
            || haystack.Contains("brave")
            || haystack.Contains("firefox")
            || haystack.Contains("zen")
            || haystack.Contains("arc")
            || haystack.Contains("dia")
            || haystack.Contains("comet")
            || haystack.Contains("opera")
            || haystack.Contains("vivaldi")
            || haystack.Contains("browser");
    }

    private static bool IsFirefoxFamily(string bundleId, string appName, string exePath)
    {
        var haystack = $"{bundleId} {appName} {exePath}".ToLowerInvariant();
        return FirefoxFamily.Any(token => haystack.Contains(token));
    }

    private static bool TryReadChromiumTab(IntPtr hwnd, out string? url, out string? pageTitle)
    {
        url = null;
        pageTitle = null;
        try
        {
            var root = AutomationElement.FromHandle(hwnd);
            if (root is null) return false;

            pageTitle = string.IsNullOrWhiteSpace(root.Current.Name) ? null : root.Current.Name.Trim();

            var edits = root.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));

            for (var i = 0; i < edits.Count; i++)
            {
                var edit = edits[i];
                var value = edit.Current.Name;
                var pattern = edit.GetCurrentPattern(ValuePattern.Pattern) as ValuePattern;
                var candidate = pattern?.Current.Value ?? value;
                if (string.IsNullOrWhiteSpace(candidate)) continue;
                candidate = candidate.Trim();
                if (!candidate.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                    && !candidate.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                url = candidate;
                return true;
            }
        }
        catch
        {
            return false;
        }

        return false;
    }

    private static void Emit(HelperEvent ev)
    {
        var json = JsonSerializer.Serialize(ev, JsonOptions);
        Console.WriteLine(json);
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);

    private sealed class HelperEvent
    {
        [JsonPropertyName("ts_ms")]
        public long TsMs { get; init; }

        [JsonPropertyName("mono_ns")]
        public long MonoNs { get; init; }

        [JsonPropertyName("event_type")]
        public string EventType { get; init; } = string.Empty;

        [JsonPropertyName("app_bundle_id")]
        public string? AppBundleId { get; init; }

        [JsonPropertyName("app_name")]
        public string? AppName { get; init; }

        [JsonPropertyName("pid")]
        public int? Pid { get; init; }

        [JsonPropertyName("window_title")]
        public string? WindowTitle { get; init; }

        [JsonPropertyName("url")]
        public string? Url { get; init; }

        [JsonPropertyName("page_title")]
        public string? PageTitle { get; init; }

        [JsonPropertyName("source")]
        public string Source { get; init; } = string.Empty;

        [JsonPropertyName("confidence")]
        public string Confidence { get; init; } = string.Empty;

        [JsonPropertyName("platform")]
        public string Platform { get; init; } = "win32";

        [JsonPropertyName("schema_ver")]
        public int SchemaVer { get; init; } = SchemaVersion;
    }
}
