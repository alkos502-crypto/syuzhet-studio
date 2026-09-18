Attribute VB_Name = "mExport"
Option Explicit

' ================= генерация CSV (полная копия buildCsv / buildMogrtCsv из студии) =================

Public ExportDateOverride As String   ' для тестов; пусто = сегодня

Private Function SepJoin(ByVal sep As String) As String
    If sep = ";" Then SepJoin = "; " Else SepJoin = sep
End Function

Private Function Cel(ByVal s As String, ByVal sep As String) As String
    If InStr(s, sep) > 0 Or InStr(s, """") > 0 Or InStr(s, vbCr) > 0 Or InStr(s, vbLf) > 0 Then
        Cel = """" & Replace(s, """", """""") & """"
    Else
        Cel = s
    End If
End Function

Private Function Rw(ByVal sep As String, ByVal c1 As String, ByVal c2 As String, _
        ByVal c3 As String, ByVal c4 As String, ByVal c5 As String) As String
    Rw = Cel(c1, sep) & SepJoin(sep) & Cel(c2, sep) & SepJoin(sep) & Cel(c3, sep) & _
         SepJoin(sep) & Cel(c4, sep) & SepJoin(sep) & Cel(c5, sep)
End Function

Private Sub AddL(ByRef L As Collection, ByVal s As String)
    L.Add s
End Sub

Private Sub AddTextLines(ByRef L As Collection, ByVal bi As Long, ByVal forceOne As Boolean)
    Dim b As Blk, j As Long
    b = BlkArr(bi)
    If b.nLines = 0 Then
        If forceOne Then AddL L, "# "
        Exit Sub
    End If
    For j = 0 To b.nLines - 1
        AddL L, "# " & b.lines(j)
    Next j
End Sub

Public Function BuildFish(doc As Document, ByVal sep As String) As String
    Scan doc
    Dim L As New Collection
    Dim dt As String
    If Len(ExportDateOverride) > 0 Then dt = ExportDateOverride Else dt = Format(Now, "yyyy-mm-dd")

    AddL L, "# Fish Cutter — сценарий, собранный в «Сюжет-Word»"
    If Len(Ttl) > 0 Then
        AddL L, "# Сюжет: " & Ttl
    Else
        AddL L, "# Сюжет: —"
    End If
    AddL L, "# Корреспондент: " & Dash(Rpt) & "; Оператор: " & Dash(Cam) & _
            "; Монтажёр: " & Dash(Edt)
    AddL L, "# Таймкод: NDF " & IIf(Len(FpsS) > 0, FpsS, "25") & " к/с; Дата: " & dt
    AddL L, "#"
    AddL L, Rw(sep, "файл", "вход", "выход", "подпись", "путь")

    Dim i As Long, j As Long, b As Blk
    For i = 0 To NBlk - 1
        b = BlkArr(i)
        Select Case b.kind
            Case "headline"
                AddL L, "#": AddL L, "# ——— ЗАГОЛОВОК " & b.num & " ———"
                AddTextLines L, i, True
            Case "vo"
                AddL L, "#": AddL L, "# ——— ЗАКАД " & b.num & " ———"
                AddTextLines L, i, True
            Case "vod"
                AddL L, "#": AddL L, "# ——— ПОДВОДКА ———"
                AddTextLines L, i, True
            Case "standup"
                AddL L, "#": AddL L, "# ——— СТЕНДАП " & b.num & " ———"
                AddTextLines L, i, True
                For j = 0 To b.nFrag - 1
                    Dim suLbl As String
                    If b.nFrag > 1 Then suLbl = "СТЕНД" & b.num & "-" & (j + 1) Else suLbl = "СТЕНД" & b.num
                    AddL L, Rw(sep, b.frags(j).file, b.frags(j).tin, b.frags(j).tout, suLbl, b.frags(j).path)
                Next j
            Case "life"
                AddL L, "#": AddL L, "# ——— ЛАЙФ " & b.num & " ———"
                AddTextLines L, i, False
                For j = 0 To b.nFrag - 1
                    Dim liLbl As String
                    If b.nFrag > 1 Then liLbl = "ЛАЙФ" & b.num & "-" & (j + 1) Else liLbl = "ЛАЙФ" & b.num
                    AddL L, Rw(sep, b.frags(j).file, b.frags(j).tin, b.frags(j).tout, liLbl, b.frags(j).path)
                Next j
            Case "spiegel"
                AddL L, "#": AddL L, "# ——— ШПИГЕЛЬ ———"
                AddTextLines L, i, False
                For j = 0 To b.nFrag - 1
                    AddL L, Rw(sep, b.frags(j).file, b.frags(j).tin, b.frags(j).tout, "ШПИГ", b.frags(j).path)
                Next j
            Case Else  ' sync
                AddL L, "#": AddL L, "# ——— СИНХРОН " & b.num & ": " & _
                        IIf(Len(b.speaker) > 0, b.speaker, "спикер") & _
                        IIf(Len(b.role) > 0, ", " & b.role, "") & " ———"
                AddTextLines L, i, True
                For j = 0 To b.nFrag - 1
                    AddL L, Rw(sep, b.frags(j).file, b.frags(j).tin, b.frags(j).tout, _
                            "СИНХ" & b.num & "-" & (j + 1) & " " & b.speaker, b.frags(j).path)
                Next j
        End Select
    Next i
    BuildFish = JoinColl(L, vbCrLf)
End Function

Private Function Dash(ByVal s As String) As String
    If Len(s) = 0 Then Dash = "—" Else Dash = s
End Function

Private Sub MogrtSpeaker(doc As Document, b As Blk, ByRef spk As String, ByRef role As String)
    spk = b.speaker
    role = b.role
    If b.kind <> "standup" Or Len(spk) > 0 Then Exit Sub
    Dim h As String, kind As String, num As Long
    h = doc.Paragraphs(b.headIdx).Range.Text
    h = NormSp(Left$(h, Len(h) - 1))
    If StartsWith(LCase$(h), "стендап") Then
        h = "Синхрон" & Mid$(h, Len("стендап") + 1)
    ElseIf StartsWith(LCase$(h), "standup") Then
        h = "Синхрон" & Mid$(h, Len("standup") + 1)
    Else
        Exit Sub
    End If
    Call ClassifyHead(h, kind, num, spk, role)
End Sub

Public Function BuildMogrt(doc As Document, ByVal sep As String) As String
    If sep <> ";" Then Err.Raise 5, "BuildMogrt", "MOGRT requires semicolon delimiter"
    Scan doc
    Dim L As New Collection
    AddL L, "Имя Фамилия;Должность"
    Dim i As Long, b As Blk, spk As String, role As String
    For i = 0 To NBlk - 1
        b = BlkArr(i)
        If b.kind = "sync" Or b.kind = "standup" Then
            MogrtSpeaker doc, b, spk, role
            If Len(spk) > 0 Then AddL L, Cel(UCase$(spk), ";") & ";" & Cel(UCase$(role), ";")
        End If
    Next i
    BuildMogrt = JoinColl(L, vbCrLf)
End Function

Public Function JoinColl(ByRef c As Collection, ByVal d As String) As String
    Dim i As Long, r As String
    For i = 1 To c.Count
        If i > 1 Then r = r & d
        r = r & CStr(c(i))
    Next i
    JoinColl = r
End Function

' ---------- сохранение ----------

Public Function TargetPath(doc As Document, ByVal fileName As String) As String
    Dim base As String
    base = OutDir
    If Len(NormSp(base)) = 0 Then base = DocFolder(doc)
    If Len(base) = 0 Then base = CurDir$
    TargetPath = PathJoin(base, fileName)
End Function

Public Function SaveCsv(doc As Document, ByVal text As String, ByVal suffix As String) As String
    Scan doc
    Dim nm As String
    nm = Slugify(IIf(Len(Ttl) > 0, Ttl, doc.Name)) & suffix
    Dim p As String
    p = TargetPath(doc, nm)
    WriteUtf8Bom p, text
    SaveCsv = p
End Function

' ---------- команды ----------

Public Function DoFishCsv(doc As Document) As String
    Dim t As String
    t = BuildFish(doc, ";")
    DoFishCsv = SaveCsv(doc, t, "_fishcutter.csv")
End Function

Public Function DoExcelCsv(doc As Document) As String
    Dim t As String
    t = BuildFish(doc, ",")
    DoExcelCsv = SaveCsv(doc, t, "_fishcutter_excel.csv")
End Function

Public Function DoMogrtCsv(doc As Document) As String
    Dim t As String
    t = BuildMogrt(doc, ";")
    DoMogrtCsv = SaveCsv(doc, t, "_mogrt.csv")
End Function

' «чистый Word»: копия файла без абзацев «Фрагмент»/«Параметры»
' (документ должен быть сохранён — иначе сначала сохраните)
Public Function DoCleanWord(doc As Document) As String
    Scan doc
    If doc.Saved = False Then doc.Save
    Dim src As String, dst As String
    src = DocFullPath(doc)
    dst = PathJoin(DocFolder(doc), Slugify(IIf(Len(Ttl) > 0, Ttl, doc.Name)) & "_чистый.docx")
    If FileOk(dst) Then Kill dst
    FileCopy src, dst
    Dim nd As Document, i As Long, raw As String, t As String
    Set nd = Documents.Open(dst)
    For i = nd.Paragraphs.Count To 1 Step -1
        raw = nd.Paragraphs(i).Range.Text
        t = NormSp(Left$(raw, Len(raw) - 1))
        If StartsWith(t, FRAG_PFX) Or StartsWith(t, PAR_PFX) Then nd.Paragraphs(i).Range.Delete
    Next i
    nd.Close wdSaveChanges
    DoCleanWord = dst
End Function

Public Function DocFullPath(doc As Document) As String
    Dim p As String
    p = doc.FullName
    If IsMac() And InStr(p, ":") > 0 And InStr(p, "/") = 0 Then
        p = HfsToPosix(p)
    End If
    DocFullPath = p
End Function
