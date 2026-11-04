|用途|Bank / Motion|源动作名|frameCount / FPS|调用入口与应用范围|
|---|---|---|---|---|
|瞄准移动-前|100 / 120|ch0100_Handgun00H_0120_Strafe_F_Loop|96 / 60|TPSBase → Bank10/Motion2；动作树节点 Mask0|
|瞄准移动-左|100 / 122|ch0100_Handgun00H_0122_Strafe_L_Loop|84 / 60|TPSBase → Bank10/Motion2；动作树节点 Mask0|
|瞄准移动-后|100 / 124|ch0100_Handgun00H_0124_Strafe_B_Loop|76 / 60|TPSBase → Bank10/Motion2；动作树节点 Mask0|
|瞄准移动-右|100 / 126|ch0100_Handgun00H_0126_Strafe_R_Loop|83 / 60|TPSBase → Bank10/Motion2；动作树节点 Mask0|
|抬枪进入|100 / 140|ch0100_Handgun00H_0140_Hold_Start_L0|30 / 60|TPSUpper → Wp0000H_140_Hold_Start_L0；Mask4：53个关节|
|持枪维持|100 / 160|ch0100_Handgun00H_0160_Hold_Loop|307 / 60|TPSBase → Bank10/Motion4；与165、167混合|
|持枪向左转|100 / 165|ch0100_Handgun00H_0165_Wheel_L_Loop|77 / 60|TPSBase → Bank10/Motion4；WheelBlendRate / WheelSpeed|
|持枪向右转|100 / 167|ch0100_Handgun00H_0167_Wheel_R_Loop|77 / 60|TPSBase → Bank10/Motion4；WheelBlendRate / WheelSpeed|
|放下枪|100 / 161|ch0100_Handgun00H_0161_Hold_End|109 / 60|TPSUpper → Hold_End分支；具体分支控制|
|单次射击|100 / 1100|ch0100_Handgun00H_1100_Shoot|30 / 60|TPSAdd → Shot/SemiAuto/Normal；附加状态机；精确层混合数学未复演|
|常规换弹主体|100 / 1200|ch0100_Handgun00H_1200_Reload|312 / 60|TPSUpper → Handgun00H_1200_Reload；Reload父节点 AutoSetJointMask2|
|常规换弹躯干补偿|2100 / 1200|ch0100_Handgun00H_1200_Reload_Add|312 / 60|UpperBodyPreAddConfiguration：层3 → 层2；Mask11：Hip 0.3，其余六关节0.5|
|另一换弹变体|100 / 1201|ch0100_Handgun00H_1201_Reload_All|194 / 60|TPSUpper → Handgun00H_1201_Reload_All；与1200分开制作，不强猜All枚举语义|
|换弹变体补偿|2100 / 1201|ch0100_Handgun00H_1201_Reload_All_Add|194 / 60|Bank偏移+2000 / Motion偏移0；Mask11|
