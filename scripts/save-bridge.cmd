@echo off
rem パル配合ノートのセーブ連携ツールを起動する（Node.js 20 以上が必要）
cd /d "%~dp0.."
node scripts\save-bridge.mjs %*
pause
