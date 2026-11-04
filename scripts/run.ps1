$ErrorActionPreference='Stop'
$src='tools/REE.PAK.Tool/REE.Unpacker/REE.Unpacker/FileSystem'
Add-Type -Path @("$src/Encryption/PakCipher.cs","$src/Package/PakHash.cs","$src/Hashing/Murmur3.cs",'scripts/Research.cs')
[Research]::Run('G:/SteamLibrary/steamapps/common/RESIDENT EVIL requiem BIOHAZARD requiem','references/RE9_STM_Release.list','reports')
