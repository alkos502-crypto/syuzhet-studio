Attribute VB_Name = "mUI"
Option Explicit

' ================= точка входа: панель, команды, новые сюжеты =================

Public Sub AutoExec()
    BindKeys
End Sub

Private Sub BindKeys()
    On Error Resume Next
    ' связка клавиш не критична; молча пропускаем отказ платформы
    On Error GoTo 0
End Sub

Public Function SU_Version() As String
    SU_Version = "Сюжет-Word 1.0"
End Function

Private Function Doc() As Document
    Set Doc = ActiveDocument
End Function

' ---------- панель (InputBox-меню, работает на Mac и Windows) ----------

Public Sub SU_Panel()
    Dim v As String
    Do
        v = InputBox("СЮЖЕТ-WORD" & vbCr & _
            "1  Настройки / авторы" & vbCr & _
            "2  Новый блок (ЗАГ/ПОДВ/ЗК/СИНХ/СТЕНД/ЛАЙФ/ШПИГ)" & vbCr & _
            "3  Фрагмент вручную (после метки в мониторе Студии)" & vbCr & _
            "4  Синхронизировать фрагменты из CSV Студии" & vbCr & _
            "5  Проверка сюжета (таймкоды, хроно)" & vbCr & _
            "6  Перенумеровать блоки по порядку" & vbCr & _
            "7  ЭКСПОРТ: CSV Fish Cutter (;)" & vbCr & _
            "8  ЭКСПОРТ: CSV для Excel (,)" & vbCr & _
            "9  ЭКСПОРТ: MOGRT титры (CSV)" & vbCr & _
            "10 ЭКСПОРТ: чистый Word для редактора" & vbCr & _
            "0  закрыть", "Сюжет-Word")
        Select Case Trim$(v)
            Case "1": SU_Settings
            Case "2": SU_AddBlock
            Case "3": SU_FragManual
            Case "4": SU_FragSync
            Case "5": SU_Check
            Case "6": SU_Renumber
            Case "7": RunExport "Fish Cutter CSV", DoFishCsv(Doc)
            Case "8": RunExport "CSV для Excel", DoExcelCsv(Doc)
            Case "9": RunExport "MOGRT CSV", DoMogrtCsv(Doc)
            Case "10": RunExport "чистый Word", DoCleanWord(Doc)
            Case Else: Exit Sub
        End Select
    Loop
End Sub

Private Sub RunExport(ByVal nm As String, ByVal p As String)
    If Len(p) = 0 Then
        MsgBox nm & ": не сохранено (пустой документ?)", vbExclamation
    Else
        If MsgBox(nm & ":" & vbCr & p & vbCr & vbCr & "Показать в Finder/Проводнике?", _
                  vbYesNo + vbInformation, "Сюжет-Word") = vbYes Then ShowInFolder p
    End If
End Sub

Public Sub SU_Renumber()
    If MsgBox("Перенумеровать заголовки блоков по порядку в документе?", vbOKCancel) = vbOK Then
        RenumberHeads Doc
    End If
End Sub

Private Sub ShowInFolder(ByVal p As String)
    On Error Resume Next
    #If Not Mac Then
        Shell "explorer /select,""" & p & """", vbNormalFocus
    #End If
    On Error GoTo 0
End Sub

' ---------- новый сюжет / оформление ----------

Public Sub SU_NewStory()
    Dim nd As Document
    On Error Resume Next
    Set nd = Documents.Add(ThisDocument.FullName, False)
    If nd Is Nothing Then Set nd = Documents.Add
    On Error GoTo 0
    nd.Content.Delete
    SetupSkeleton nd
    MsgBox "Новый сюжет создан. Заполните название, реквизиты и «параметры» (или 1 на панели).", _
           vbInformation, "Сюжет-Word"
End Sub

' привести текущий документ к скелету сюжета
Public Sub SU_SetupHere()
    SetupSkeleton Doc
End Sub

Private Sub SetupSkeleton(doc As Document)
    EnsureStyles doc
    ResetDefaults
    Dim r As Range
    Set r = doc.Content
    r.Text = "Сюжет без названия" & vbCr & _
        "Корреспондент: -" & vbVerticalTab & "Оператор: -" & vbVerticalTab & _
        "Монтажёр: -" & vbVerticalTab & "Дата: " & Format(Now, "yyyy-mm-dd") & vbCr & _
        PAR_PFX & " fps: 25 | темп: 540 | план: | исходники: | выгрузка:" & vbCr & _
        "Заголовок 1" & vbCr & "Тема дня — первая строка." & vbCr
    doc.Paragraphs(1).Style = doc.Styles(wdStyleHeading1)
    doc.Paragraphs(4).Style = doc.Styles(wdStyleHeading2)
    FixSpecialStyles doc
End Sub

' ---------- настройки / авторы ----------

Public Sub SU_Settings()
    Dim doc As Document
    Set doc = Doc
    Scan doc
    Ttl = Ask("Название сюжета", Ttl)
    If Len(Ttl) = 0 Then Ttl = "Сюжет без названия"
    Rpt = Ask("Корреспондент", Rpt)
    Cam = Ask("Оператор", Cam)
    Edt = Ask("Монтажёр", Edt)
    Dte = Format(Now, "yyyy-mm-dd")
    FpsS = Ask("FPS таймкода (25, 29.97, 30, 50, 59.94…)", IIf(Len(FpsS) > 0, FpsS, "25"))
    If Fb <> ClngSafe(FpsS, 25) Then Fb = ClngSafe(FpsS, 25)
    Skor = ClngSafe(Ask("Темп чтеца, зн/мин", CStr(Skor)), 540)
    PlanS = Ask("План хроно, мм:сс (пусто — без плана)", PlanS)
    Dim p As String
    p = AskFolder("Папка исходников (видео)", Root)
    If Len(p) > 0 Then Root = p
    p = AskFolder("Папка выгрузки CSV (пусто — рядом с документом)", OutDir)
    If Len(p) >= 0 Then OutDir = p

    WriteHeader doc
    WriteParLine doc
    MsgBox "Настройки записаны." & vbCr & "fps=" & FpsS & "  темп=" & Skor & vbCr & _
           "исходники: " & Root, vbInformation, "Сюжет-Word"
End Sub

Private Sub WriteHeader(doc As Document)
    Dim h1 As String
    h1 = doc.Styles(wdStyleHeading1).NameLocal
    Dim i As Long
    For i = 1 To doc.Paragraphs.Count
        If doc.Paragraphs(i).Style.NameLocal = h1 Then Exit For
    Next i
    If i > doc.Paragraphs.Count Then
        doc.Paragraphs(1).Style = doc.Styles(wdStyleHeading1)
        doc.Paragraphs(1).Range.Text = Ttl & vbCr
    Else
        doc.Paragraphs(i).Range.Text = Ttl & vbCr
    End If
    ' реквизиты
    Scan doc
    Dim raw As String
    raw = "Корреспондент: " & NV(Rpt) & vbVerticalTab & "Оператор: " & NV(Cam) & vbVerticalTab & _
          "Монтажёр: " & NV(Edt) & vbVerticalTab & "Дата: " & NV(Dte) & vbCr
    If ReqIdx > 0 Then
        doc.Paragraphs(ReqIdx).Range.Text = raw
    Else
        InsertParAfter doc, i, Left$(raw, Len(raw) - 1), "Normal"
    End If
End Sub

Private Function NV(ByVal s As String) As String
    If Len(s) = 0 Then NV = "-" Else NV = s
End Function

' ---------- блоки ----------

Public Sub SU_AddBlock()
    Dim doc As Document
    Set doc = Doc
    Scan doc
    Dim v As String
    v = InputBox("Тип блока:" & vbCr & "1 ЗАГ (заголовок)   2 ПОДВ (подводка)   3 ЗК (закадр)" & vbCr & _
        "4 СИНХ (синхрон)  5 СТЕНД    6 ЛАЙФ    7 ШПИГ", "Сюжет-Word", "3")
    Dim kind As String
    Select Case Trim$(v)
        Case "1": kind = "headline"
        Case "2": kind = "vod"
        Case "3": kind = "vo"
        Case "4": kind = "sync"
        Case "5": kind = "standup"
        Case "6": kind = "life"
        Case "7": kind = "spiegel"
        Case Else: Exit Sub
    End Select
    Dim spk As String, role As String
    If kind = "sync" Then
        Dim s2 As Variant
        s2 = InputBox("Спикер и должность («Имя Фамилия, должность»):", "Синхрон")
        If InStr(s2, ",") > 0 Then
            spk = NormSp(Left$(s2, InStr(s2, ",") - 1))
            role = NormSp(Mid$(s2, InStr(s2, ",") + 1))
        Else
            spk = NormSp(s2)
        End If
    End If
    ' вставить после блока с курсором (или в конец)
    Dim bi As Long
    bi = CurrentBlockIdx(doc)
    Dim anchor As Long
    If bi < 0 Then
        anchor = doc.Paragraphs.Count
    Else
        anchor = BlkArr(bi).lastIdx
    End If
    Dim cnt As Long
    cnt = CountKind(kind) + 1
    InsertParAfter doc, anchor, HeadText(kind, cnt, spk, role), "#hidden#"
    doc.Paragraphs(anchor + 1).Style = doc.Styles(wdStyleHeading2)
    InsertParAfter doc, anchor + 1, "", "Normal"
    FixSpecialStyles doc
    Scan doc
    ' пересчитать номера (порядок мог сдвинуться)
    RenumberHeadsQuiet doc
    On Error Resume Next
    doc.Paragraphs(anchor + 2).Range.Select
    On Error GoTo 0
End Sub

Private Function CountKind(ByVal kind As String) As Long
    Dim i As Long, n As Long
    For i = 0 To NBlk - 1
        If BlkArr(i).kind = kind Then n = n + 1
    Next i
    CountKind = n
End Function

Private Function FindBlockByHead(doc As Document, ByVal idx As Long) As Long
    Dim i As Long
    FindBlockByHead = 0
    For i = 0 To NBlk - 1
        If BlkArr(i).headIdx = idx Then FindBlockByHead = i: Exit Function
        If BlkArr(i).headIdx > idx Then FindBlockByHead = IIf(i > 0, i - 1, 0): Exit Function
    Next i
End Function

Private Sub RenumberHeadsQuiet(doc As Document)
    Scan doc
    Dim i As Long, b As Blk
    For i = 0 To NBlk - 1
        b = BlkArr(i)
        If b.numHead <> b.num Then
            doc.Paragraphs(b.headIdx).Range.Text = HeadText(b.kind, b.num, b.speaker, b.role) & vbCr
        End If
    Next i
End Sub

' ---------- фрагмент вручную ----------

Public Sub SU_FragManual()
    Dim doc As Document
    Set doc = Doc
    Scan doc
    Dim bi As Long
    bi = CurrentBlockIdx(doc)
    If bi < 0 Then
        MsgBox "Поставьте курсор в блок СИНХ / СТЕНД / ЛАЙФ / ШПИГ."
        Exit Sub
    End If
    Select Case BlkArr(bi).kind
        Case "headline", "vo", "vod"
            MsgBox "В текстовых блоках (" & KindName(BlkArr(bi).kind) & ") фрагментов не бывает."
            Exit Sub
    End Select
    Dim full As String
    full = AskFile("Файл видео", Root)
    If Len(full) = 0 Then Exit Sub
    Dim f As Frag
    f.file = BaseName(full)
    f.path = RelToRoot(full, Root)
    f.tin = Ask("Таймкод входа HH:MM:SS:FF", "00:00:00:00")
    f.tout = Ask("Таймкод выхода HH:MM:SS:FF", "00:00:00:00")
    If Not IsTc(f.tin) Or Not IsTc(f.tout) Then
        MsgBox "Нужен формат HH:MM:SS:FF (например 00:01:12:05)."
        Exit Sub
    End If
    InsertParAfter doc, BlkArr(bi).lastIdx, FragLine(f), ST_FRAG
    FixSpecialStyles doc
    Scan doc
    RenumberHeadsQuiet doc
End Sub

' ---------- синхронизация из fish-CSV Студии ----------

Public Sub SU_FragSync()
    Dim doc As Document
    Set doc = Doc
    Dim p As String
    p = AskFileCsv("Выберите fish-CSV, скачанный из Студии")
    If Len(p) = 0 Then Exit Sub
    Dim rep As String
    On Error GoTo fail
    rep = SyncFromCsvText(doc, ReadUtf8(p))
    MsgBox rep, vbInformation, "Синхронизация фрагментов"
    Exit Sub
fail:
    MsgBox "Не удалось прочитать CSV: " & Err.Description, vbExclamation
End Sub

' ---------- экспорт и проверка ----------

Public Sub SU_Check()
    MsgBox CheckReport(Doc), vbInformation, "Проверка сюжета"
End Sub

Public Sub SU_Fish()
    RunExport "Fish Cutter CSV", DoFishCsv(Doc)
End Sub

Public Sub SU_Excel()
    RunExport "CSV для Excel", DoExcelCsv(Doc)
End Sub

Public Sub SU_Mogrt()
    RunExport "MOGRT CSV", DoMogrtCsv(Doc)
End Sub

Public Sub SU_Clean()
    RunExport "чистый Word", DoCleanWord(Doc)
End Sub

' ---------- общие диалоги ----------

Private Function Ask(ByVal prompt As String, ByVal v As String) As String
    Ask = NormSp(InputBox(prompt, "Сюжет-Word", v))
End Function

Private Function AskFolder(ByVal prompt As String, ByVal cur As String) As String
    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFolderPicker)
    fd.Title = prompt
    On Error Resume Next
    If Len(cur) > 0 Then fd.InitialFileName = cur
    If fd.Show = -1 Then AskFolder = fd.SelectedItems(1) Else AskFolder = cur
    On Error GoTo 0
End Function

Private Function AskFile(ByVal prompt As String, ByVal curDirHint As String) As String
    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    fd.Title = prompt
    fd.AllowMultiSelect = False
    On Error Resume Next
    #If Not Mac Then
        fd.Filters.Clear
        fd.Filters.Add "Видео", "*.mp4;*.mov;*.mxf;*.mts;*.m2ts;*.avi;*.mkv;*.mpg;*.mpeg;*.wmv"
    #End If
    If Len(curDirHint) > 0 Then fd.InitialFileName = curDirHint
    If fd.Show = -1 Then AskFile = fd.SelectedItems(1)
    On Error GoTo 0
End Function

Private Function AskFileCsv(ByVal prompt As String) As String
    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    fd.Title = prompt
    fd.AllowMultiSelect = False
    On Error Resume Next
    #If Not Mac Then
        fd.Filters.Clear
        fd.Filters.Add "CSV", "*.csv"
    #End If
    If fd.Show = -1 Then AskFileCsv = fd.SelectedItems(1)
    On Error GoTo 0
End Function

' ---------- callbacks для ленты (Windows customUI) ----------
Public Sub RX_Panel(ByVal o As Object): SU_Panel: End Sub
Public Sub RX_Fish(ByVal o As Object): SU_Fish: End Sub
Public Sub RX_Sync(ByVal o As Object): SU_FragSync: End Sub
Public Sub RX_Check(ByVal o As Object): SU_Check: End Sub
