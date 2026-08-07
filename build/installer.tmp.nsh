!macro customInstall
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq EXECUTABLE_NAME.exe" /NH'
    Pop $0
    ${If} $0 != ""
        nsExec::ExecToLog 'taskkill /F /IM "EXECUTABLE_NAME.exe" /T'
        Sleep 2000
        nsExec::ExecToLog 'taskkill /F /IM "EXECUTABLE_NAME.exe" /T'
        Sleep 1500
    ${EndIf}
    WriteRegStr SHCTX "Software\Classes\*\shell\OnlyPreview" "" "Open in Bitterless"
    WriteRegStr SHCTX "Software\Classes\*\shell\OnlyPreview" "Icon" "$INSTDIR\EXECUTABLE_NAME.exe"
    WriteRegStr SHCTX "Software\Classes\*\shell\OnlyPreview\command" "" '"$INSTDIR\EXECUTABLE_NAME.exe" "%1"'
!macroend

!macro customUnInstall
    DeleteRegKey SHCTX "Software\Classes\*\shell\OnlyPreview"
!macroend
