Attribute VB_Name = "mCheck"
Option Explicit

' ================= проверка сюжета / хронометраж / перенумерация =================

Public Function CheckReport(doc As Document) As String
    Scan doc
    Dim r As New Collection
    Dim i As Long, j As Long, b As Blk, fr As Frag, bad As String

    If Len(Ttl) = 0 Then r.Add "НЕТ НАЗВАНИЯ: первый абзац (стиль «Заголовок 1») — название сюжета"
    If Not HasPar Then r.Add "Нет строки «параметры | …» — нажмите 1 (Настройки), она создастся"
    If Len(Rpt) = 0 Then r.Add "Не заполнен корреспондент (строка реквизитов)"

    Dim totalF As Long
    Dim chars As Long
    For i = 0 To NBlk - 1
        b = BlkArr(i)
        Select Case b.kind
            Case "headline", "vo", "vod"
                If b.nFrag > 0 Then _
                    r.Add KindName(b.kind) & " " & b.num & ": в текстовом блоке не должно быть фрагментов"
                For j = 0 To b.nLines - 1
                    chars = chars + Len(b.lines(j))
                Next j
            Case "sync"
                If Len(b.speaker) = 0 Then r.Add "Синхрон " & b.num & ": не указан спикер в заголовке"
                If b.nFrag = 0 Then r.Add "Синхрон " & b.num & ": нет ни одного фрагмента"
        End Select
        If b.kind <> "headline" And b.kind <> "vo" And b.kind <> "vod" Then
            For j = 0 To b.nFrag - 1
                fr = b.frags(j)
                bad = ""
                If Not IsTc(fr.tin) Then bad = "неверный таймкод входа «" & fr.tin & "»"
                If bad = "" And Not IsTc(fr.tout) Then bad = "неверный таймкод выхода «" & fr.tout & "»"
                If bad = "" Then
                    If TcFramesField(fr.tin) >= Fb Or TcFramesField(fr.tout) >= Fb Then _
                        bad = "кадр в таймкоде >= " & Fb & " (fps)"
                End If
                If bad = "" Then
                    If TcToFr(fr.tout, Fb) < TcToFr(fr.tin, Fb) Then bad = "выход раньше входа"
                End If
                If bad <> "" Then r.Add KindName(b.kind) & " " & b.num & ", фрагмент " & (j + 1) & _
                        " (" & fr.file & "): " & bad
                totalF = totalF + (TcToFr(fr.tout, Fb) - TcToFr(fr.tin, Fb))
            Next j
        End If
        If b.kind = "standup" Or b.kind = "life" Or b.kind = "spiegel" Then
            For j = 0 To b.nLines - 1
                chars = chars + Len(b.lines(j))
            Next j
        End If
    Next i

    Dim sec As Long
    sec = totalF \ Fb
    If Len(PlanS) > 0 Then
        Dim pl As Long
        pl = ParseClock(PlanS)
        If pl < 0 Then
            r.Add "План «" & PlanS & "» не разбирается (ждём мм:сс или чч:мм:сс)"
        Else
            If sec + TextEstSec(chars) > pl Then
                r.Add "ХРОНО ПРЕВЫШАЕТ ПЛАН: " & ClockStr(sec + TextEstSec(chars)) & " > " & PlanS
            Else
                r.Add "Хроно " & ClockStr(sec + TextEstSec(chars)) & " (фрагменты " & ClockStr(sec) & _
                        " + текст ~" & ClockStr(TextEstSec(chars)) & "), план " & PlanS & " — ок"
            End If
        End If
    Else
        r.Add "ИТОГО ~" & ClockStr(sec + TextEstSec(chars)) & " (фрагменты " & ClockStr(sec) & _
                " + текст ~" & ClockStr(TextEstSec(chars)) & ")"
    End If
    If Len(Unknowns) > 0 Then r.Add "Заголовки H2 не распознаны (станут текстом блока): " & Unknowns

    Dim k As Long, out As String
    If r.Count = 1 Then
        If Len(r(1)) > 0 Then out = "Проверка пройдена. " & r(1) Else out = "Проверка пройдена."
    Else
        For k = 1 To r.Count
            out = out & r(k) & vbCr
        Next k
    End If
    CheckReport = out
End Function

Private Function TextEstSec(ByVal chars As Long) As Long
    If Skor < 1 Then Skor = 540
    TextEstSec = Round(chars / Skor * 60)
End Function

Public Function ClockStr(ByVal sec As Long) As String
    ClockStr = Pad2(sec \ 60) & ":" & Pad2(sec Mod 60)
End Function

' привести заголовки блоков к каноничным номерам по порядку в документе
Public Sub RenumberHeads(doc As Document)
    Scan doc
    Dim i As Long, b As Blk
    For i = 0 To NBlk - 1
        b = BlkArr(i)
        Dim want As String
        want = HeadText(b.kind, b.num, b.speaker, b.role)
        If b.numHead <> b.num Or NormSp(doc.Paragraphs(b.headIdx).Range.Text) <> want Then
            doc.Paragraphs(b.headIdx).Range.Text = want & vbCr
        End If
    Next i
End Sub
