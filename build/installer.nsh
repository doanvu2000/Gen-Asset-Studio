!include "getProcessInfo.nsh"
Var pid

!macro gasKillTree
  nsExec::Exec `"$CmdPath" /C taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    ${if} ${isUpdated}
      Sleep 1000
    ${endIf}
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      ${ifNot} ${isUpdated}
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK gasKill
        Quit
      ${endIf}
      gasKill:
      DetailPrint "$(appClosing)"
      !insertmacro gasKillTree
      Sleep 1500
      StrCpy $R1 0
      gasLoop:
        IntOp $R1 $R1 + 1
        !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          ${if} $R1 == 1
            DetailPrint `Closing "${PRODUCT_NAME}" with administrator rights.`
            ExecShellWait "runas" "$SYSDIR\taskkill.exe" `/F /T /IM "${APP_EXECUTABLE_FILENAME}"` SW_HIDE
            Sleep 1500
            Goto gasLoop
          ${endIf}
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY gasRetry
          Quit
          gasRetry:
          !insertmacro gasKillTree
          Sleep 1500
          Goto gasLoop
        ${endIf}
    ${endIf}
  ${endIf}
!macroend
