Attribute VB_Name = "mModel"
Option Explicit

' ================= модель документа «Сюжет» =================
' Heading1 = название; строка реквизитов («Корреспондент: …» и др., абзац с
' переносами); Heading2 = блоки; Normal = текст; стиль «СюжФрагмент» =
' строки «фрагмент | файл | HH:MM:SS:FF - HH:MM:SS:FF | путь»;
' стиль «СюжПараметры» = «параметры | fps: 25 | темп: 540 | план: 02:30 |
' исходники: /… | выгрузка: …».

Public Const ST_FRAG As String = "СюжФрагмент"
Public Const ST_PAR As String = "СюжПараметры"
Public Const FRAG_PFX As String = "фрагмент | "
Public Const PAR_PFX As String = "параметры |"

Public Type Frag
    file As String
    tin As String
    tout As String
    path As String
End Type

Public Type Blk
    kind As String        ' headline | vod | vo | sync | standup | life | spiegel
    num As Long           ' порядковый номер среди блоков своего вида
    headIdx As Long       ' индекс абзаца заголовка (1-based)
    lastIdx As Long       ' индекс последнего абзаца блока (текст/фрагменты)
    speaker As String
    role As String
    numHead As Long       ' номер, написанный в самом заголовке (0 — нет)
    nLines As Long
    lines() As String
    nFrag As Long
    frags() As Frag
End Type

Public BlkArr() As Blk
Public NBlk As Long
Public Ttl As String
Public Rpt As String, Cam As String, Edt As String, Dte As String
Public FpsS As String     ' как вводить: «25», «29.97»…
Public Fb As Long         ' кадров в секунду таймкода (round(fps))
Public Skor As Long       ' темп чтеца, зн/мин
Public Root As String     ' папка исходников
Public OutDir As String   ' папка выгрузки CSV
Public PlanS As String    ' план, мм:сс
Public Unknowns As String ' заголовки H2, не распознанные как блоки
Public ReqIdx As Long     ' абзац реквизитов (0 — нет)
Public ParIdx As Long     ' абзац «параметры | …» (0 — нет)
Public HasPar As Boolean

Public Function KindName(ByVal k As String) As String
    Select Case k
        Case "headline": KindName = "Заголовок"
        Case "vod": KindName = "Подводка"
        Case "vo": KindName = "Закадровый текст"
        Case "sync": KindName = "Синхрон"
        Case "standup": KindName = "Стендап"
        Case "life": KindName = "Лайф"
        Case "spiegel": KindName = "Шпигель"
        Case Else: KindName = k
    End Select
End Function

' полный список видов (для счётчиков и обхода)
Public Function KindList() As String
    KindList = "headline|vod|vo|sync|standup|life|spiegel"
End Function

' текст канонического заголовка блока
Public Function HeadText(ByVal k As String, ByVal n As Long, _
        ByVal spk As String, ByVal role As String) As String
    Select Case k
        Case "headline": HeadText = "Заголовок " & n
        Case "vod": HeadText = "Подводка"
        Case "vo": HeadText = "Закадровый текст " & n
        Case "standup": HeadText = "Стендап " & n
        Case "life": HeadText = "Лайф " & n
        Case "spiegel": HeadText = "Шпигель"
        Case "sync"
            HeadText = "Синхрон " & n & ". " & spk
            If Len(role) > 0 Then HeadText = HeadText & ", " & role
        Case Else: HeadText = k
    End Select
End Function

' ---------- распознавание заголовков (как parseWordHead в студии) ----------

Private Function KwAfter(ByVal l As String, ByVal kw As String, ByRef tail As String) As Boolean
    If Left$(l, Len(kw)) <> kw Then Exit Function
    tail = Mid$(l, Len(kw) + 1)
    KwAfter = True
End Function

' kw + следующий символ — не буква (для «vo », «зк.», «lead …»)
Private Function KwWordL(ByVal l As String, ByVal kw As String, ByRef tail As String) As Boolean
    Dim t As String
    If Not KwAfter(l, kw, t) Then Exit Function
    If Len(t) = 0 Then tail = t: KwWordL = True: Exit Function
    Dim c As String
    c = Left$(t, 1)
    If c = " " Or c = "." Or c = ChrW(65294) Then tail = Mid$(t, 2) Else tail = t
    KwWordL = True
End Function

' kw и сразу (после пробелов) число
Private Function KwNum(ByVal l As String, ByVal kw As String, ByRef tail As String, ByRef num As Long) As Boolean
    Dim t As String
    If Not KwAfter(l, kw, t) Then Exit Function
    t = Trim$(t)
    If Len(t) = 0 Then Exit Function
    If Not IsDigitCh(Left$(t, 1)) Then Exit Function
    num = FirstNum(t)
    ' остаток после цифр
    Dim i As Long
    i = 1
    Do While i <= Len(t)
        If IsDigitCh(Mid$(t, i, 1)) Then i = i + 1 Else Exit Do
    Loop
    tail = Mid$(t, i + 1)
    KwNum = True
End Function

Public Function ClassifyHead(ByVal h As String, ByRef kind As String, _
        ByRef num As Long, ByRef spk As String, ByRef role As String) As Boolean
    Dim s As String, l As String, tail As String
    s = NormSp(h)
    l = LCase$(s)
    kind = "": num = 0: spk = "": role = ""
    If Len(l) = 0 Then Exit Function
    If KwNum(l, "заголовок", tail, num) Or KwNum(l, "headline", tail, num) Then
        kind = "headline": GoTo done
    End If
    If StartsWith(l, "закадр") Then
        tail = Mid$(l, 7): num = FirstNum(tail): kind = "vo": GoTo done
    End If
    If KwWordL(l, "зк", tail) Then
        num = FirstNum(tail): kind = "vo": GoTo done
    End If
    If KwWordL(l, "vo", tail) Then
        num = FirstNum(tail): kind = "vo": GoTo done
    End If
    If KwNum(l, "стендап", tail, num) Or KwNum(l, "standup", tail, num) Then
        kind = "standup": GoTo done
    End If
    If KwNum(l, "лайф", tail, num) Or KwNum(l, "life", tail, num) Then
        kind = "life": GoTo done
    End If
    If StartsWith(l, "шпигель") Or StartsWith(l, "spiegel") Then
        kind = "spiegel": GoTo done
    End If
    If StartsWith(l, "подвод") Or KwWordL(l, "lead", tail) Then
        kind = "vod": GoTo done
    End If
    If KwNum(l, "синхрон", tail, num) Or KwNum(l, "sot", tail, num) Then
        kind = "sync"
        Dim parts As Variant, p As Variant
        tail = Trim$(Replace(tail, ChrW(65294), "."))   '/fullwidth dot/ -> '.'
        If Left$(tail, 1) = "." Then tail = Trim$(Mid$(tail, 2))
        parts = SplitParts(tail, ",")
        If UBound(parts) = 0 Then parts = SplitParts(tail, ";")
        spk = NormSp(CStr(parts(0)))
        Dim j As Long, r As String
        For j = 1 To UBound(parts)
            If Len(r) > 0 Then r = r & ", "
            r = r & NormSp(CStr(parts(j)))
        Next j
        role = r
        GoTo done
    End If
    Exit Function
done:
    ' обязательная нумерация (как в студии): headline/vo/standup/life/sync
    If num = 0 Then
        Select Case kind
            Case "headline", "vo", "standup", "life", "sync": kind = ""
        End Select
    End If
    ClassifyHead = (Len(kind) > 0)
End Function

' ---------- стили ----------

Public Sub EnsureStyles(doc As Document)
    If Not StyleExists(doc, ST_FRAG) Then
        Dim s As Object
        Set s = doc.Styles.Add(ST_FRAG, wdStyleTypeParagraph)
        s.BaseStyle = doc.Styles(wdStyleNormal).NameLocal
        s.Font.Size = 9
        s.Font.Color = RGB(105, 105, 105)
        s.Font.Name = "Courier New"
    End If
    If Not StyleExists(doc, ST_PAR) Then
        Dim s2 As Object
        Set s2 = doc.Styles.Add(ST_PAR, wdStyleTypeParagraph)
        s2.BaseStyle = doc.Styles(wdStyleNormal).NameLocal
        s2.Font.Size = 8
        s2.Font.Color = RGB(150, 150, 150)
        s2.Font.Italic = True
    End If
End Sub

Public Function StyleExists(doc As Document, ByVal nm As String) As Boolean
    Dim s As Object
    On Error Resume Next
    Set s = Nothing
    Set s = doc.Styles(nm)
    On Error GoTo 0
    StyleExists = Not (s Is Nothing)
End Function

Private Function PSN(p As Paragraph) As String
    On Error Resume Next
    PSN = p.Style.NameLocal
    On Error GoTo 0
End Function

' ---------- разбор параметров и фрагментов ----------

Public Function FragLine(f As Frag) As String
    FragLine = FRAG_PFX & f.file & " | " & f.tin & " - " & f.tout & " | " & f.path
End Function

Public Function ParseFragLine(ByVal t As String, ByRef f As Frag) As Boolean
    Dim a As Variant, r As Variant
    If Not StartsWith(t, FRAG_PFX) Then Exit Function
    a = SplitParts(CStr(Mid$(t, Len(FRAG_PFX) + 1)), " | ")
    If UBound(a) < 2 Then Exit Function
    f.file = Trim$(CStr(a(0)))
    r = SplitParts(CStr(a(1)), " - ")
    If UBound(r) <> 1 Then Exit Function
    f.tin = Trim$(CStr(r(0)))
    f.tout = Trim$(CStr(r(1)))
    If UBound(a) >= 3 Then f.path = Trim$(CStr(a(2))) Else f.path = f.file
    ParseFragLine = True
End Function

Public Function ParLine() As String
    ParLine = PAR_PFX & " fps: " & FpsS & " | темп: " & Skor _
            & " | план: " & PlanS & " | исходники: " & Root & " | выгрузка: " & OutDir
End Function

Private Sub ParseParLine(ByVal t As String)
    Dim a As Variant, kv As Variant, k As String, v As String, i As Long
    a = SplitParts(Mid$(t, Len(PAR_PFX) + 1), "|")
    For i = LBound(a) To UBound(a)
        kv = SplitParts(CStr(a(i)), ":")
        If UBound(kv) >= 1 Then
            k = LCase$(NormSp(CStr(kv(0))))
            v = Mid$(CStr(a(i)), InStr(CStr(a(i)), ":") + 1)
            v = NormSp(v)
            Select Case k
                Case "fps": FpsS = v: Fb = ClngSafe(v, 25)
                Case "темп", "temp", "speach", "speed": Skor = ClngSafe(v, 540)
                Case "план": PlanS = v
                Case "исходники", "root": Root = v
                Case "выгрузка", "out": OutDir = v
            End Select
        End If
    Next i
End Sub

Public Function ClngSafe(ByVal s As String, ByVal dflt As Long) As Long
    Dim v As Double
    On Error GoTo bad
    v = Val(Replace(s, ",", "."))
    If v <= 0 Then ClngSafe = dflt: Exit Function
    ClngSafe = CLng(v)
    Exit Function
bad:
    ClngSafe = dflt
End Function

' fps -> кадров/сек таймкода (round, как в студии)
Public Function FpsRound() As Long
    If Fb < 1 Then Fb = 25
    FpsRound = Fb
End Function

' ---------- основной проход по документу ----------

Public Sub ResetDefaults()
    FpsS = "25": Fb = 25: Skor = 540
    Root = "": OutDir = "": PlanS = ""
End Sub

Public Sub Scan(doc As Document)
    Dim paras As Paragraphs
    ReDim BlkArr(0 To 127)
    NBlk = 0
    Ttl = "": Rpt = "": Cam = "": Edt = "": Dte = "": Unknowns = ""
    ReqIdx = 0: ParIdx = 0: HasPar = False
    ResetDefaults
    Dim h1 As String, h2 As String
    h1 = doc.Styles(wdStyleHeading1).NameLocal
    h2 = doc.Styles(wdStyleHeading2).NameLocal
    Dim counters() As Long
    Dim kl As Variant: kl = SplitParts(KindList(), "|")
    ReDim counters(0 To UBound(kl))
    Dim raw As String, t As String, st As String
    Dim kind As String, num As Long, spk As String, role As String
    Dim i As Long
    For i = 1 To doc.Paragraphs.Count
        raw = doc.Paragraphs(i).Range.Text
        t = NormSp(Left$(raw, Len(raw) - 1))
        st = PSN(doc.Paragraphs(i))
        If t = "" Then GoTo nextp
        If st = h1 Then
            If Len(Ttl) = 0 Then Ttl = t
            GoTo nextp
        End If
        If st = h2 Then
            If ClassifyHead(t, kind, num, spk, role) Then
                Dim b As Long, j As Long
                b = 0
                For j = 0 To UBound(kl)
                    If CStr(kl(j)) = kind Then
                        counters(j) = counters(j) + 1
                        b = counters(j)
                        Exit For
                    End If
                Next j
                If NBlk > UBound(BlkArr) Then ReDim Preserve BlkArr(0 To NBlk * 2)
                BlkArr(NBlk).kind = kind
                BlkArr(NBlk).num = b
                BlkArr(NBlk).numHead = num
                BlkArr(NBlk).headIdx = i
                BlkArr(NBlk).lastIdx = i
                BlkArr(NBlk).speaker = spk
                BlkArr(NBlk).role = role
                BlkArr(NBlk).nLines = 0
                BlkArr(NBlk).nFrag = 0
                ReDim BlkArr(NBlk).lines(0 To 31)
                ReDim BlkArr(NBlk).frags(0 To 15)
                NBlk = NBlk + 1
            Else
                If Len(Unknowns) > 0 Then Unknowns = Unknowns & "; "
                Unknowns = Unknowns & Left$(t, 60)
            End If
            GoTo nextp
        End If
        If StartsWith(t, FRAG_PFX) Then
            If NBlk > 0 Then
                Dim fr As Frag
                If ParseFragLine(t, fr) Then
                    If BlkArr(NBlk - 1).nFrag > UBound(BlkArr(NBlk - 1).frags) Then _
                        ReDim Preserve BlkArr(NBlk - 1).frags(0 To BlkArr(NBlk - 1).nFrag * 2)
                    BlkArr(NBlk - 1).frags(BlkArr(NBlk - 1).nFrag) = fr
                    BlkArr(NBlk - 1).nFrag = BlkArr(NBlk - 1).nFrag + 1
                    BlkArr(NBlk - 1).lastIdx = i
                End If
            End If
            GoTo nextp
        End If
        If StartsWith(t, PAR_PFX) Then
            ParseParLine t
            ParIdx = i: HasPar = True
            GoTo nextp
        End If
        ' обычный текст
        If NBlk > 0 Then
            Dim ln As Variant
            ln = ParaRawLines(doc.Paragraphs(i))
            Dim lj As Long
            For lj = LBound(ln) To UBound(ln)
                If BlkArr(NBlk - 1).nLines > UBound(BlkArr(NBlk - 1).lines) Then _
                    ReDim Preserve BlkArr(NBlk - 1).lines(0 To BlkArr(NBlk - 1).nLines * 2)
                BlkArr(NBlk - 1).lines(BlkArr(NBlk - 1).nLines) = CStr(ln(lj))
                BlkArr(NBlk - 1).nLines = BlkArr(NBlk - 1).nLines + 1
            Next lj
            BlkArr(NBlk - 1).lastIdx = i
        ElseIf InStr(LCase$(t), ChrW(1082) & "орреспондент:") > 0 Then
            ParseRequisites doc.Paragraphs(i)
            ReqIdx = i
        End If
nextp:
    Next i
End Sub

' строки абзаца (внутренние vbCr -> отдельные строки текста блока)
Private Function ParaRawLines(p As Paragraph) As Variant
    Dim raw As String, a As Variant
    raw = p.Range.Text
    raw = Left$(raw, Len(raw) - 1)
    raw = Replace(raw, vbCr, vbLf)
    raw = Replace(raw, vbVerticalTab, vbLf)
    a = SplitParts(raw, vbLf)
    Dim i As Long
    For i = LBound(a) To UBound(a)
        a(i) = NormSp(CStr(a(i)))
    Next i
    ParaRawLines = a
End Function

  ' реквизиты: абзац со строками «Корреспондент: X» и т.п.
Private Sub ParseRequisites(p As Paragraph)
    Dim raw As String, a As Variant, i As Long, key As String, v As String, line As String
    raw = p.Range.Text
    raw = Replace(raw, vbCr, vbLf)
    raw = Replace(raw, vbVerticalTab, vbLf)
    a = SplitParts(raw, vbLf)
    For i = LBound(a) To UBound(a)
        line = CStr(a(i))
        If InStr(line, ":") > 0 Then
            key = LCase$(NormSp(Left$(line, InStr(line, ":") - 1)))
            key = Replace(key, ChrW(1105), ChrW(1077))     ' ё -> е
            v = NormSp(Mid$(line, InStr(line, ":") + 1))
            Select Case key
                Case "корреспондент": Rpt = TrimDash(v)
                Case "оператор": Cam = TrimDash(v)
                Case "монтажер": Edt = TrimDash(v)
                Case "дата": Dte = v
            End Select
        End If
    Next i
End Sub

Private Function TrimDash(ByVal s As String) As String
    If s = "-" Or s = ChrW(8212) Then TrimDash = "" Else TrimDash = s
End Function

' индекс блока, к которому относится текущая позиция курсора (-1 — нет)
Public Function CurrentBlockIdx(doc As Document) As Long
    Dim selP As Long, i As Long, j As Long
    selP = doc.Selection.Range.Paragraphs(1).Range.Start
    CurrentBlockIdx = -1
    For i = 0 To NBlk - 1
        Dim idx As Long
        idx = BlkArr(i).headIdx
        If doc.Paragraphs(idx).Range.Start <= selP Then CurrentBlockIdx = i
    Next i
End Function

' вставить абзац с нужным текстом сразу после абзаца endIdx
Public Sub InsertParAfter(doc As Document, ByVal endIdx As Long, _
        ByVal text As String, ByVal styleNm As String)
    Dim r As Range
    Set r = doc.Paragraphs(endIdx).Range
    r.Collapse wdCollapseEnd
    r.InsertAfter text & vbCr
    Dim p As Paragraph
    For Each p In r.Paragraphs
        If Len(NormSp(p.Range.Text)) > 0 Then
            On Error Resume Next
            p.Style = doc.Styles(styleNm)
            On Error GoTo 0
        End If
    Next p
End Sub

' убрать у всех абзацев префиксами спец-стилей корректные стили
Public Sub FixSpecialStyles(doc As Document)
    EnsureStyles doc
    Dim i As Long, t As String
    For i = 1 To doc.Paragraphs.Count
        t = NormSp(Left$(doc.Paragraphs(i).Range.Text, Len(doc.Paragraphs(i).Range.Text) - 1))
        If StartsWith(t, FRAG_PFX) Then
            If PSN(doc.Paragraphs(i)) <> ST_FRAG Then doc.Paragraphs(i).Style = doc.Styles(ST_FRAG)
        ElseIf StartsWith(t, PAR_PFX) Then
            If PSN(doc.Paragraphs(i)) <> ST_PAR Then doc.Paragraphs(i).Style = doc.Styles(ST_PAR)
        End If
    Next i
End Sub

' удалить абзац(ы) [aIdx..bIdx] включительно
Public Sub DeleteParRange(doc As Document, ByVal aIdx As Long, ByVal bIdx As Long)
    Dim r As Range
    Set r = doc.Range(doc.Paragraphs(aIdx).Range.Start, doc.Paragraphs(bIdx).Range.End)
    r.Delete
End Sub
