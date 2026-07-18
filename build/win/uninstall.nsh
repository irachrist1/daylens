# Uninstall cleanup for Daylens (electron-builder customUnInstall hook).
#
# Electron's app.setLoginItemSettings registers launch-on-login as an HKCU Run
# value named after the AppUserModelId. Without this hook a Windows uninstall
# leaves that value pointing at a deleted exe — the stale-login-item pattern
# DEV-213 removes. The value names cover the current AUMID, the pre-rename
# AUMID, and the product name as a safety net for older installs.
#
# Data: electron-builder's uninstaller only deletes app data when launched with
# --delete-app-data (the in-app "Reset and uninstall" flow passes it after the
# person confirms). A manual, interactive uninstall gets an explicit yes/no
# prompt instead of silent deletion; silent uninstalls (updates, /S) never
# delete data unless the flag was passed.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.daylens.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "dev.christiantonny.daylens"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Daylens"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.daylens.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "dev.christiantonny.daylens"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Daylens"

    ${if} $isDeleteAppData == "1"
      # The built-in block already removed $APPDATA\Daylens and $APPDATA\daylens;
      # also remove the legacy data directory older installs used.
      RMDir /r "$APPDATA\DaylensWindows"
    ${else}
      ${ifNot} ${Silent}
        MessageBox MB_YESNO|MB_ICONQUESTION "Also delete your local Daylens data (timeline database and settings)?$\r$\n$\r$\nChoose No to keep it for a future install." /SD IDNO IDYES daylensDeleteData IDNO daylensKeepData
        daylensDeleteData:
          RMDir /r "$APPDATA\Daylens"
          RMDir /r "$APPDATA\daylens"
          RMDir /r "$APPDATA\DaylensWindows"
        daylensKeepData:
      ${endif}
    ${endif}
  ${endif}
!macroend
