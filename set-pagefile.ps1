# 把 D 盘页面文件设成 32 GB（临时脚本，跑完即删）
# 系统现在自动管理，只有 5.7 GB，训练时提交内存不够（WinError 1455）。
$cs = Get-WmiObject -Class Win32_ComputerSystem
if ($cs.AutomaticManagedPagefile) {
  $cs.AutomaticManagedPagefile = $false
  $cs.Put() | Out-Null
  "auto managed -> off"
}
$set = Get-WmiObject -Class Win32_PageFileSetting -Filter "Name='D:\\\\pagefile.sys'"
if ($set) {
  $set.InitialSize = 32768
  $set.MaximumSize = 32768
  $set.Put() | Out-Null
  "updated D: pagefile to 32768"
} else {
  $new = ([WMIClass]"Win32_PageFileSetting").CreateInstance()
  $new.Name = "D:\pagefile.sys"
  $new.InitialSize = 32768
  $new.MaximumSize = 32768
  $new.Put() | Out-Null
  "created D: pagefile 32768"
}
Get-WmiObject -Class Win32_PageFileSetting | ForEach-Object { "$($_.Name) $($_.InitialSize)-$($_.MaximumSize)" }
