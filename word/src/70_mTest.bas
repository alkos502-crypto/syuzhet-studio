Attribute VB_Name = "mTest"
Option Explicit

' все тестовые файлы пишутся в <папка шаблона>/test — portable-путь
Private Function TDir() As String
    Dim d As String
    d = PathJoin(DocFolder(ThisDocument), "test")
    On Error Resume Next
    MkDir d
    On Error GoTo 0
    TDir = d
End Function

Private Function TF(ByVal nm As String) As String
    TF = PathJoin(TDir(), nm)
End Function


' ================= тестовая обвязка (вызывается из AppleScript «run VB macro») =================

Public Sub SU_T_PROBE()
    ' проверка путей/кодировок на этой машине
    Dim t As String
    t = "posix:" & vbCrLf
    WriteUtf8Bom TF("su_probe.txt"), "Привет,тест UTF-8 OK"
    t = t & "write ok, read back: " & Left$(ReadUtf8(TF("su_probe.txt")), 40) & vbCrLf
    t = t & "FileLen=" & FileLen(TF("su_probe.txt")) & vbCrLf
    t = t & "os=" & Application.OperatingSystem & vbCrLf
    Dim d As Document
    Set d = Documents.Add
    t = t & "doc.Path=" & d.Path & vbCrLf
    t = t & "doc.FullName=" & d.FullName & vbCrLf
    t = t & "CurDir=" & CurDir$ & vbCrLf
    d.Close False
    WriteUtf8Bom TF("su_probe.txt"), t
End Sub

Private Function MkDoc() As Document
    Dim nd As Document
    Set nd = Documents.Add
    nd.Content.Delete
    Dim r As Range
    Set r = nd.Content
    r.Text = "Про ремонт дорог" & vbCr & _
        "Корреспондент: А. Иванов" & vbVerticalTab & "Оператор: П. Сидоров" & vbVerticalTab & _
        "Монтажёр: С. Монтажный" & vbVerticalTab & "Дата: 2026-05-01" & vbCr & _
        "параметры | fps: 25 | темп: 540 | план: | исходники: | выгрузка:" & vbCr
    nd.Paragraphs(1).Style = nd.Styles(wdStyleHeading1)
    Set MkDoc = nd
End Function

Private Sub AddBlock(nd As Document, ByVal head As String, ByVal text As String, ByVal frags As String)
    Dim r As Range
    Set r = nd.Content
    r.Collapse wdCollapseEnd
    r.InsertAfter head & vbCr
    If Len(text) > 0 Then r.InsertAfter text & vbCr
    Dim fa As Variant, i As Long
    If Len(frags) > 0 Then
        fa = SplitParts(frags, ";")
        For i = LBound(fa) To UBound(fa)
            If Len(NormSp(CStr(fa(i)))) > 0 Then r.InsertAfter CStr(fa(i)) & vbCr
        Next i
    End If
    r.Style = nd.Styles(wdStyleNormal)
    nd.Range(r.Start, r.Start + Len(head)).Style = nd.Styles(wdStyleHeading2)
End Sub

' собрать фикстуру (те же данные использует test/golden.py)
Private Function BuildFixture() As Document
    Dim nd As Document
    Set nd = MkDoc()
    Call AddBlock(nd, "Заголовок 1", "Про ремонт дорог", "")
    Call AddBlock(nd, "Закадровый текст 1", _
        "Осенью в городе начнут ремонтировать четыре магистрали.", "")
    Call AddBlock(nd, "Синхрон 1. Иван Петров, директор завода", _
        "Мы уже подали документы в администрацию.", _
        "фрагмент | A001C003.mov | 00:00:10:00 - 00:00:14:12 | sub/A001C003.mov;" & _
        "фрагмент | B mov.mov | 00:01:00:00 - 00:01:05:00 | B mov.mov")
    Call AddBlock(nd, "Стендап 1. А. Иванов, корреспондент", "Корреспондент у катка.", _
        "фрагмент | C1.mxf | 00:02:00:00 - 00:02:03:00 | C1.mxf")
    Call AddBlock(nd, "Лайф 1", "", _
        "фрагмент | D.mts | 00:03:00:00 - 00:03:02:11 | archive/2025/D.mts")
    Call AddBlock(nd, "Шпигель", "", _
        "фрагмент | E.mp4 | 00:00:05:00 - 00:00:09:00 | E.mp4;" & _
        "фрагмент | E.mp4 | 00:00:20:00 - 00:00:23:00 | E.mp4")
    Call AddBlock(nd, "Подводка", "Директор завода — о планах.", "")
    Call AddBlock(nd, "Закадровый текст 2", "Работы обещают закончить к декабрю.", "")
    Call AddBlock(nd, "Синхрон 2. Анна Сергеевна Иванова", "", _
        "фрагмент | F.mov | 00:00:01:00 - 00:00:04:00 | F.mov")
    FixSpecialStyles nd
    Set BuildFixture = nd
End Function

Private Sub AssertMogrt(nd As Document, ByVal expected As String)
    If BuildMogrt(nd, ";") <> expected Then
        Err.Raise vbObjectError + 701, "SU_T_Mogrt", "MOGRT contract mismatch"
    End If
End Sub

Public Sub SU_T_Mogrt()
    Dim nd As Document, header As String
    Dim errNum As Long, errText As String
    On Error GoTo failed
    header = "Имя Фамилия;Должность"
    Set nd = BuildFixture()
    AssertMogrt nd, header & vbCrLf & "ИВАН ПЕТРОВ;ДИРЕКТОР ЗАВОДА" & vbCrLf & _
        "А. ИВАНОВ;КОРРЕСПОНДЕНТ" & vbCrLf & "АННА СЕРГЕЕВНА ИВАНОВА;"
    nd.Close False
    Set nd = MkDoc()
    AssertMogrt nd, header
    Call AddBlock(nd, "Синхрон 1.", "", "")
    Call AddBlock(nd, "Стендап 1", "", "")
    Call AddBlock(nd, "Закадровый текст 1", "Лишний титр", "")
    Call AddBlock(nd, "STANDUP 2. Ёлка ""Имя"", редактор; ведущая", "", "")
    Call AddBlock(nd, "Синхрон 2. Анна Мария", "", "")
    Call AddBlock(nd, "Синхрон 3. Анна Мария", "", "")
    FixSpecialStyles nd
    AssertMogrt nd, header & vbCrLf & """ЁЛКА """"ИМЯ"""""";""РЕДАКТОР; ВЕДУЩАЯ""" & _
        vbCrLf & "АННА МАРИЯ;" & vbCrLf & "АННА МАРИЯ;"
    nd.Close False
    Exit Sub
failed:
    errNum = Err.Number
    errText = Err.Description
    On Error Resume Next
    If Not nd Is Nothing Then nd.Close False
    On Error GoTo 0
    Err.Raise errNum, "SU_T_Mogrt", errText
End Sub

Public Sub SU_T_Export()
    Dim nd As Document
    Set nd = BuildFixture()
    ExportDateOverride = "2026-05-01"
    OutDir = TDir()
    Scan nd
    WriteUtf8Bom TF("su_fish.csv"), BuildFish(nd, ";")
    WriteUtf8Bom TF("su_fish_excel.csv"), BuildFish(nd, ",")
    WriteUtf8Bom TF("su_mogrt.csv"), BuildMogrt(nd, ";")
    ' отчёт проверки
    WriteUtf8Bom TF("su_check.txt"), CheckReport(nd)
    nd.Close False
End Sub

' фикстура БЕЗ фрагментов + синхронизация из /tmp/su_fish.csv -> /tmp/su_after_sync_fish.csv
Public Sub SU_T_Sync()
    Dim nd As Document
    Set nd = BuildFixture()
    Dim i As Long, raw As String
    For i = nd.Paragraphs.Count To 1 Step -1
        raw = nd.Paragraphs(i).Range.Text
        If StartsWith(NormSp(Left$(raw, Len(raw) - 1)), FRAG_PFX) Then nd.Paragraphs(i).Range.Delete
    Next i
    Dim rep As String
    rep = SyncFromCsvText(nd, ReadUtf8(TF("su_fish.csv")))
    WriteUtf8Bom TF("su_sync_report.txt"), rep
    ExportDateOverride = "2026-05-01"
    WriteUtf8Bom TF("su_after_sync_fish.csv"), BuildFish(nd, ";")
    nd.Close False
End Sub

' проверка на «сломанном» документе
Public Sub SU_T_CheckBad()
    Dim nd As Document
    Set nd = BuildFixture()
    Dim i As Long, raw As String, t As String
    For i = 1 To nd.Paragraphs.Count
        raw = nd.Paragraphs(i).Range.Text
        If InStr(raw, FRAG_PFX) > 0 And InStr(raw, "00:00:10:00") > 0 Then
            nd.Paragraphs(i).Range.Text = Replace(raw, "00:00:14:12", "00:00:09:27") & vbCr
            Exit For
        End If
    Next i
    WriteUtf8Bom TF("su_check_bad.txt"), CheckReport(nd)
    nd.Close False
End Sub

' чистый Word: из фикстуры в /tmp
Public Sub SU_T_Clean()
    Dim nd As Document
    Set nd = BuildFixture()
    nd.SaveAs PathJoin(TDir(), "su_fixture_src.docx"), wdFormatXMLDocument
    Scan nd
    OutDir = TDir()
    Dim p As String
    p = DoCleanWord(nd)
    WriteUtf8Bom TF("su_clean_path.txt"), p
    nd.Close False
End Sub
