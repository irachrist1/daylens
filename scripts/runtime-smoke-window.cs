using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

internal static class RuntimeCaptureProbe
{
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 4)
            throw new ArgumentException("Usage: RuntimeCaptureProbe <title> <foreground|fullscreen> <duration-seconds> <state-path>");

        var title = args[0];
        var mode = args[1];
        var duration = int.Parse(args[2]);
        var statePath = args[3];

        Application.EnableVisualStyles();
        using var form = new Form
        {
            Text = title,
            StartPosition = FormStartPosition.CenterScreen,
            Size = new Size(900, 600),
            TopMost = true,
        };

        form.Shown += (_, __) =>
        {
            if (mode == "fullscreen")
            {
                form.FormBorderStyle = FormBorderStyle.None;
                form.WindowState = FormWindowState.Normal;
                form.Bounds = Screen.PrimaryScreen.Bounds;
            }
            form.Activate();
            SetForegroundWindow(form.Handle);
            SetCursorPos(form.Bounds.Left + 20, form.Bounds.Top + 20);
            WriteState(statePath, mode, title, form);

            var timer = new Timer { Interval = duration * 1000 };
            timer.Tick += (_, __) =>
            {
                timer.Stop();
                form.Close();
            };
            timer.Start();
        };

        Application.Run(form);
    }

    private static void WriteState(string path, string mode, string title, Form form)
    {
        var state = File.Exists(path)
            ? JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(path)) ?? new()
            : new Dictionary<string, JsonElement>();
        var value = JsonSerializer.SerializeToElement(new
        {
            title,
            activated = Form.ActiveForm == form,
            fullscreen = form.FormBorderStyle == FormBorderStyle.None && form.Bounds == Screen.PrimaryScreen.Bounds,
        });
        state[mode == "fullscreen" ? "fullscreen" : "foreground"] = value;
        File.WriteAllText(path, JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true }));
    }
}
