!macro customInstall
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq EXECUTABLE_NAME.exe" /NH'
    Pop $0
    ${If} $0 != ""
        nsExec::ExecToLog 'taskkill /F /IM "EXECUTABLE_NAME.exe" /T'
        Sleep 2000
        nsExec::ExecToLog 'taskkill /F /IM "EXECUTABLE_NAME.exe" /T'
        Sleep 1500
    ${EndIf}
ONLY_PREVIEW_INSTALL
!macroend

!macro customUnInstall
ONLY_PREVIEW_UNINSTALL
!macroend
