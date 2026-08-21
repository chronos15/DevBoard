package main

import (
	"syscall"
	"unsafe"
)

const (
	wmApp              = 0x8000
	wmTrayCallback     = wmApp + 0x41
	wmLButtonDblClk    = 0x0203
	wmRButtonUp        = 0x0205
	wmDestroy          = 0x0002
	idiApplication     = 32512
	nimAdd             = 0x00000000
	nimDelete          = 0x00000002
	nifMessage         = 0x00000001
	nifIcon            = 0x00000002
	nifTip             = 0x00000004
	mfString           = 0x00000000
	mfSeparator        = 0x00000800
	tpmReturnCmd       = 0x0100
	tpmRightButton     = 0x0002
	trayCmdOpenHome    = 1001
	trayCmdOpenDev     = 1002
	trayCmdDiagnostics = 1003
	trayCmdExit        = 1099
)

type wndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

type point struct{ X, Y int32 }

var (
	shell32                 = syscall.NewLazyDLL("shell32.dll")
	procShellNotifyIconW    = shell32.NewProc("Shell_NotifyIconW")
	procRegisterClassExW    = user32.NewProc("RegisterClassExW")
	procCreateWindowExW     = user32.NewProc("CreateWindowExW")
	procDefWindowProcW      = user32.NewProc("DefWindowProcW")
	procLoadIconW           = user32.NewProc("LoadIconW")
	procCreatePopupMenu     = user32.NewProc("CreatePopupMenu")
	procAppendMenuW         = user32.NewProc("AppendMenuW")
	procTrackPopupMenu      = user32.NewProc("TrackPopupMenu")
	procDestroyMenu         = user32.NewProc("DestroyMenu")
	procGetCursorPos        = user32.NewProc("GetCursorPos")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procPostQuitMessage     = user32.NewProc("PostQuitMessage")
	procTranslateMessage    = user32.NewProc("TranslateMessage")
	procDispatchMessageW    = user32.NewProc("DispatchMessageW")

	trayHWND    uintptr
	trayReady   bool
	trayAppURL  string
	trayWndProc uintptr
)

func trayIsReady() bool { return trayReady && trayHWND != 0 }

func startTray(appURL string) bool {
	trayAppURL = appURL
	className, _ := syscall.UTF16PtrFromString("DevboardAgentTrayWindow")
	trayWndProc = syscall.NewCallback(trayWindowProc)
	instance, _, _ := procGetModuleHandleW.Call(0)
	wc := wndClassEx{CbSize: uint32(unsafe.Sizeof(wndClassEx{})), LpfnWndProc: trayWndProc, HInstance: instance, LpszClassName: className}
	_, _, _ = procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	windowName, _ := syscall.UTF16PtrFromString("Devboard Agent")
	hwnd, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(windowName)), 0, 0, 0, 0, 0, 0, 0, instance, 0)
	if hwnd == 0 {
		return false
	}
	trayHWND = hwnd
	icon, _, _ := procLoadIconW.Call(0, idiApplication)
	data := notifyIconData{CbSize: uint32(unsafe.Sizeof(notifyIconData{})), HWnd: hwnd, UID: 1, UFlags: nifMessage | nifIcon | nifTip, UCallbackMessage: wmTrayCallback, HIcon: icon}
	copy(data.SzTip[:], syscall.StringToUTF16("Devboard Agent"))
	ok, _, _ := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&data)))
	trayReady = ok != 0
	return trayReady
}

func stopTray() {
	if trayHWND == 0 {
		return
	}
	data := notifyIconData{CbSize: uint32(unsafe.Sizeof(notifyIconData{})), HWnd: trayHWND, UID: 1}
	procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&data)))
	trayReady = false
}

func trayWindowProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	if msg == wmTrayCallback {
		switch uint32(lParam) {
		case wmLButtonDblClk:
			go openDevboard(trayAppURL)
			return 0
		case wmRButtonUp:
			showTrayMenu(hwnd)
			return 0
		}
	}
	if msg == wmDestroy {
		stopTray()
		procPostQuitMessage.Call(0)
		return 0
	}
	result, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

func showTrayMenu(hwnd uintptr) {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	defer procDestroyMenu.Call(menu)
	appendTrayItem(menu, mfString, trayCmdOpenHome, "Abrir Devboard")
	appendTrayItem(menu, mfString, trayCmdOpenDev, "Painel Dev")
	appendTrayItem(menu, mfString, trayCmdDiagnostics, "Diagnóstico do Agent")
	appendTrayItem(menu, mfSeparator, 0, "")
	appendTrayItem(menu, mfString, trayCmdExit, "Sair do Agent")
	var pt point
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(hwnd)
	command, _, _ := procTrackPopupMenu.Call(menu, tpmReturnCmd|tpmRightButton, uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0)
	switch command {
	case trayCmdOpenHome:
		go openDevboardPath(trayAppURL, "/")
	case trayCmdOpenDev:
		go openDevboard(trayAppURL)
	case trayCmdDiagnostics:
		go openDevboardPath(trayAppURL, "/dev#integration-windows")
	case trayCmdExit:
		stopTray()
		procPostQuitMessage.Call(0)
	}
}

func appendTrayItem(menu uintptr, flags, id uintptr, label string) {
	var ptr *uint16
	if label != "" {
		ptr, _ = syscall.UTF16PtrFromString(label)
	}
	procAppendMenuW.Call(menu, flags, id, uintptr(unsafe.Pointer(ptr)))
}

func dispatchWindowMessage(msg *winMsg) {
	procTranslateMessage.Call(uintptr(unsafe.Pointer(msg)))
	procDispatchMessageW.Call(uintptr(unsafe.Pointer(msg)))
}
